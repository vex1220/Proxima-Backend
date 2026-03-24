// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================
// The orchestrator. When an event happens in the app, call `emitNotification`
// with the event type and context. The service will:
//
//   1. Find all rules that listen to that event
//   2. Evaluate each rule to see if it should fire
//   3. Check deduplication to prevent repeat sends
//   4. Save the notification to the database (in-app log)
//   5. Send a push notification to the user's devices
//
// This is the ONLY function you need to call from controllers. Everything
// else (which rules to check, dedup logic, push delivery) is handled
// internally by the rule engine.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │  USAGE IN A CONTROLLER:                                             │
// │                                                                     │
// │  import { emitNotification } from "../notifications";               │
// │                                                                     │
// │  // After creating a comment:                                       │
// │  emitNotification({                                                 │
// │    event: NotificationEvent.COMMENT_CREATED,                        │
// │    actorId: currentUser.id,                                         │
// │    postId: post.id,                                                 │
// │    postTitle: post.title,                                           │
// │    postOwnerId: post.posterId,                                      │
// │    commentId: createdComment.id,                                    │
// │  });                                                                │
// │                                                                     │
// │  // That's it! The rule engine handles the rest.                    │
// └──────────────────────────────────────────────────────────────────────┘
// =============================================================================

import { NotificationContext, NotificationType } from "./notificationTypes";
import { getRulesForEvent } from "./notificationRules";
import { hasBeenSent, recordSent, createNotification } from "./notificationDao";
import { getNotificationPreferencesDao } from "../dao/userServiceDao";
import { sendPushToUser } from "./pushService";
import { getIo } from "../websocket/ioInstance";
import { getNearbyUsers, getNearbyOfflineUsers } from "../utils/redisUserLocation";
import { getUserSocketMap } from "../websocket/setupSocket";
import { getMutedLocationIdsDao } from "../dao/MutedLocationDao";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";
import { prisma } from "../utils/prisma";
import logger from "../utils/logger";

const NOTIF_PREF_MAP: Record<string, "notifComments" | "notifKarma" | "notifInactiveReminder" | "notifLocationActivity" | "notifDMs" | "notifProximity"> = {
  NEW_COMMENT: "notifComments",
  KARMA_MILESTONE: "notifKarma",
  INACTIVE_REMINDER: "notifInactiveReminder",
  NEW_POST_IN_FEED: "notifLocationActivity",
  NEW_CHATROOM_MESSAGE: "notifLocationActivity",
  NEW_DM: "notifDMs",
  DM_ACCEPTED: "notifDMs",
  NEW_PROXIMITY_MESSAGE: "notifProximity",
};

const LOCATION_BROADCAST_TYPES = new Set<string>([
  NotificationType.NEW_POST_IN_FEED,
  NotificationType.NEW_CHATROOM_MESSAGE,
  NotificationType.NEW_PROXIMITY_MESSAGE,
]);

/**
 * Main entry point: emit a notification event.
 *
 * This function is intentionally async-fire-and-forget from the caller's
 * perspective. Notification failures should NEVER break the main request.
 * That's why we catch all errors internally.
 *
 * @param ctx - The event context (who did what, to which resource)
 */
export async function emitNotification(
  ctx: NotificationContext
): Promise<void> {
  try {
    // Step 1: Find rules that care about this event
    const rules = getRulesForEvent(ctx.event);

    if (rules.length === 0) {
      return; // No rules registered for this event
    }

    // Step 2: Evaluate each rule
    for (const rule of rules) {
      try {
        // Ask the rule: "should we send a notification for this context?"
        const payload = rule.evaluate(ctx);

        if (!payload) {
          continue; // Rule decided not to fire — move on
        }

        // Check deduplication
        // For broadcast types, dedup is global (userId=0) since they target many users
        const dedupeKey = rule.dedupeKey(ctx);
        const dedupeUserId = LOCATION_BROADCAST_TYPES.has(payload.type) ? 0 : payload.userId;
        if (dedupeKey !== null) {
          const alreadySent = await hasBeenSent(dedupeKey, dedupeUserId, rule.dedupeWindowMs);
          if (alreadySent) {
            logger.info(`[Notification] Skipping "${rule.name}" (deduped)`);
            continue;
          }
        }

        // Location-broadcast notifications use a different delivery path
        if (LOCATION_BROADCAST_TYPES.has(payload.type)) {
          if (dedupeKey !== null) {
            await recordSent(dedupeKey, dedupeUserId);
          }
          broadcastLocationNotification(ctx, payload).catch((err) =>
            logger.error(`[Notification] Broadcast failed for rule "${rule.name}":`, err)
          );
          logger.info(`[Notification] Queued broadcast for "${rule.name}"`);
          continue;
        }

        // Check if user has disabled this notification type
        const prefKey = NOTIF_PREF_MAP[payload.type];
        if (prefKey) {
          const prefs = await getNotificationPreferencesDao(payload.userId);
          if (!prefs[prefKey]) {
            logger.info(`[Notification] Skipping "${rule.name}" for user ${payload.userId} (disabled by user)`);
            continue;
          }
        }

        // Record the send before delivering (prevents race conditions on slow push)
        if (dedupeKey !== null) {
          await recordSent(dedupeKey, payload.userId);
        }

        // Send push notification (non-blocking)
        // We don't await this — push delivery runs in the background.
        sendPushToUser(payload).catch((err) =>
          logger.error(`[Notification] Push failed for rule "${rule.name}":`, err)
        );

        logger.info(
          `[Notification] Sent "${rule.name}" to user ${payload.userId}`
        );
      } catch (ruleErr) {
        // One rule failing should not prevent other rules from running
        logger.error(
          `[Notification] Rule "${rule.name}" failed:`,
          ruleErr
        );
      }
    }
  } catch (error) {
    // Top-level catch — notification errors should NEVER propagate
    logger.error("[Notification] emitNotification failed:", error);
  }
}

// =============================================================================
// LOCATION BROADCAST
// =============================================================================
// For NEW_POST_IN_FEED and NEW_CHATROOM_MESSAGE, we broadcast a real-time
// `locationActivity` event to all online users at the location via WebSocket.
// This bypasses the normal single-user push path since these target many users.
// =============================================================================

async function broadcastLocationNotification(
  ctx: NotificationContext,
  payload: { type: string; title: string; body: string; data?: Record<string, any> }
): Promise<void> {
  const io = getIo();
  const userSocketMap = getUserSocketMap();
  const isProximity = payload.type === NotificationType.NEW_PROXIMITY_MESSAGE;

  // Determine broadcast center and radius
  let lat: number;
  let lng: number;
  let radius: number;
  let locationName: string | undefined;

  if (isProximity) {
    if (ctx.senderLatitude == null || ctx.senderLongitude == null) return;
    lat = ctx.senderLatitude;
    lng = ctx.senderLongitude;
    radius = ctx.senderRadius ?? 1609;
    locationName = undefined;
  } else {
    if (!ctx.locationId) return;
    const location = await prisma.location.findUnique({
      where: { id: ctx.locationId },
      select: { id: true, name: true, latitude: true, longitude: true, size: true },
    });
    if (!location || location.latitude == null || location.longitude == null || location.size == null) {
      logger.warn(`[Notification] Location ${ctx.locationId} missing coords — skipping broadcast`);
      return;
    }
    lat = location.latitude;
    lng = location.longitude;
    radius = location.size;
    locationName = location.name;
  }

  const prefKey = NOTIF_PREF_MAP[payload.type] as keyof Awaited<ReturnType<typeof getNotificationPreferencesDao>> | undefined;

  // ── Online WebSocket broadcast (unchanged for non-proximity types) ──
  if (!isProximity && io) {
    const nearbyUserIds = await getNearbyUsers(lat, lng, radius);
    const onlineUserIds = nearbyUserIds.filter((id) => id !== ctx.actorId && userSocketMap[id] != null);

    const activeChatroomUserIds = new Set<number>();
    if (ctx.chatRoomId) {
      const roomSockets = io.sockets.adapter.rooms.get(String(ctx.chatRoomId));
      if (roomSockets) {
        const socketToUser: Record<string, number> = {};
        for (const [uid, entry] of Object.entries(userSocketMap)) {
          socketToUser[entry.socketId] = Number(uid);
        }
        for (const socketId of roomSockets) {
          const uid = socketToUser[socketId];
          if (uid !== undefined) activeChatroomUserIds.add(uid);
        }
      }
    }

    const locationActivityPayload = {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      locationName,
      chatRoomName: ctx.chatRoomName,
      timestamp: new Date().toISOString(),
    };

    for (const userId of onlineUserIds) {
      if (activeChatroomUserIds.has(userId)) continue;
      if (prefKey) {
        try {
          const prefs = await getNotificationPreferencesDao(userId);
          if (!prefs[prefKey]) continue;
        } catch {}
      }
      io.to(`user:${userId}`).emit("locationActivity", locationActivityPayload);
    }

    logger.info(`[Notification] Broadcast "${payload.type}" to ${onlineUserIds.length} online users at ${locationName ?? "proximity"}`);
  }

  // ── Offline push notification path ──
  const offlineUserIds = await getNearbyOfflineUsers(lat, lng, radius);
  const eligibleOfflineIds = offlineUserIds.filter((id) => id !== ctx.actorId && userSocketMap[id] == null);

  if (eligibleOfflineIds.length === 0) return;

  let offlinePushCount = 0;
  for (const userId of eligibleOfflineIds) {
    try {
      // Block list check
      const blockedIds = new Set(await getCachedBlockRelatedUserIds(userId));
      if (ctx.actorId && blockedIds.has(ctx.actorId)) continue;

      // Muted location check (only for location-based, not proximity)
      if (!isProximity && ctx.locationId) {
        const mutedIds = await getMutedLocationIdsDao(userId);
        if (mutedIds.has(ctx.locationId)) continue;
      }

      // User preference check
      if (prefKey) {
        const prefs = await getNotificationPreferencesDao(userId);
        if (!prefs[prefKey]) continue;
      }

      // Per-user offline dedup
      const offlineDedup = isProximity
        ? `offline_proxmsg:user:${userId}`
        : ctx.chatRoomId
          ? null // no dedup for chatroom messages per user request
          : `offline_post:loc:${ctx.locationId}:user:${userId}`;

      if (offlineDedup) {
        const offlineDedupWindow = isProximity ? 5 * 60 * 1000 : 5 * 60 * 1000;
        const alreadySent = await hasBeenSent(offlineDedup, userId, offlineDedupWindow);
        if (alreadySent) continue;
        await recordSent(offlineDedup, userId);
      }

      const pushPayload = { userId, type: payload.type as any, title: payload.title, body: payload.body, data: payload.data };
      sendPushToUser(pushPayload).catch((err) =>
        logger.error(`[Notification] Offline push failed for user ${userId}:`, err)
      );
      createNotification(pushPayload).catch((err) =>
        logger.error(`[Notification] Offline notification record failed for user ${userId}:`, err)
      );
      offlinePushCount++;
    } catch (err) {
      logger.error(`[Notification] Offline push check failed for user ${userId}:`, err);
    }
  }

  if (offlinePushCount > 0) {
    logger.info(`[Notification] Sent offline push "${payload.type}" to ${offlinePushCount} user(s)`);
  }
}

/**
 * Convenience: emit notification without awaiting (for use in controllers
 * where you don't want to block the response).
 *
 * This is just syntactic sugar — it calls emitNotification and catches
 * any unhandled errors, ensuring the caller is never affected.
 */
export function emitNotificationAsync(ctx: NotificationContext): void {
  emitNotification(ctx).catch((err) =>
    logger.error("[Notification] Async emit failed:", err)
  );
}
