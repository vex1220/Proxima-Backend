import { Server, Socket } from "socket.io";
import {
  getNearbyUsers,
  saveUserLocation,
  getUserLocation,
  filterMutuallyNearbyUsers,
  removeUserLocation,
} from "../utils/redisUserLocation";
import { UserWithPreferences } from "../models/userTypes";
import { ProximityMessageService } from "../services/ProximityMessageService";
import { validateImageUrl } from "../utils/validateImageUrl";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";
import { isUserSuspendedById } from "../services/userService";
import { enqueueModerationJob } from "../moderation";

const proximityMessageService = new ProximityMessageService();

export function setupProximitySocket(
  io: Server,
  socket: Socket,
  user: UserWithPreferences,
  userSocketMap: {
    [userId: number]: {
      socketId: string;
      proximityRadius: number;
    };
  },
) {
  // ── Throttle: only recalculate nearby count every 10 seconds max ────────
  // The location is ALWAYS saved to Redis (fast single GEOADD), but the
  // expensive part — GEORADIUS + mutual filtering + block list lookups — only
  // runs when enough time has passed. Without this, every 10-second heartbeat
  // from every connected user triggers a full scan, and it gets linearly
  // slower as you add more locations/users.
  let lastCountCalcTime = 0;
  const COUNT_THROTTLE_MS = 10_000;

  socket.on("updateLocation", async ({ latitude, longitude }) => {
    try {
      // Always save location — this is a single fast GEOADD
      await saveUserLocation(user.id, { latitude, longitude });

      // Only recalculate nearby count if enough time has passed
      const now = Date.now();
      if (now - lastCountCalcTime < COUNT_THROTTLE_MS) return;
      lastCountCalcTime = now;

      const senderRadius = userSocketMap[user.id]?.proximityRadius ?? 1600;
      const nearbyUserIds = await getNearbyUsers(latitude, longitude, senderRadius);

      // Pre-filter: only keep users who are actually connected right now.
      // GEORADIUS returns stale entries from users who disconnected but whose
      // Redis geo entry hasn't been cleaned up yet. Filtering here avoids
      // wasted GEOPOS lookups in filterMutuallyNearbyUsers.
      const connectedNearbyIds = nearbyUserIds.filter(
        (id) => id !== user.id && userSocketMap[id] != null
      );

      // Filter out blocked users before counting nearby users
      const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
      const visibleNearbyUserIds = connectedNearbyIds.filter(
        (id) => !blockedUserIds.has(id)
      );

      const mutualSocketIds = await filterMutuallyNearbyUsers(
        user.id,
        { latitude, longitude },
        visibleNearbyUserIds,
        userSocketMap,
      );

      const nearbyCount = Array.isArray(mutualSocketIds) ? mutualSocketIds.length : 0;
      socket.emit("nearbyUserCount", { count: nearbyCount });
    } catch (error: any) {
      socket.emit("error", "An unexpected error has occurred");
    }
  });

  socket.on("proximityTyping", async ({ isTyping, latitude, longitude }) => {
    try {
      const senderRadius = userSocketMap[user.id]?.proximityRadius ?? 1600;
      const nearbyUserIds = await getNearbyUsers(latitude, longitude, senderRadius);

      // Filter out blocked users from typing indicators too
      const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
      const visibleNearbyUserIds = nearbyUserIds.filter(
        (id) => id !== user.id && !blockedUserIds.has(id)
      );

      const mutualSocketIds = await filterMutuallyNearbyUsers(
        user.id,
        { latitude, longitude },
        visibleNearbyUserIds,
        userSocketMap,
      );

      if (Array.isArray(mutualSocketIds)) {
        mutualSocketIds.forEach((socketId) => {
          io.to(socketId).emit("nearbyUserTyping", {
            displayId: user.displayId,
            isTyping,
          });
        });
      }
    } catch (error: any) {
      // Typing is best-effort — don't surface errors to the client
    }
  });

  socket.on(
    "sendProximityMessage",
    async ({ latitude, longitude, content, imageUrl: rawImageUrl }) => {
      try {
        const imageUrl = validateImageUrl(rawImageUrl) ?? undefined;
        if (!content && !imageUrl) {
          socket.emit("error", "Message cannot be empty");
          return;
        }
        if (content && content.length > 2000) {
          socket.emit("error", "Message too long");
          return;
        }

        // Block suspended users from sending proximity messages (fresh DB check)
        const { suspended, until: suspendedUntil } = await isUserSuspendedById(user.id);
        if (suspended) {
          return socket.emit("suspended", { suspendedUntil: suspendedUntil!.toISOString() });
        }

        // Run DB write and nearby-user calculation in parallel — they're
        // independent and this cuts ~200ms off the critical path.
        const senderRadius = user.preferences?.proximityRadius ?? 500;

        const [message, broadcastPrep] = await Promise.all([
          proximityMessageService.createProximityMessage(
            user.id,
            content,
            latitude,
            longitude,
            imageUrl,
          ),
          (async () => {
            const currentUserLocation = await getUserLocation(String(user.id));
            if (!currentUserLocation) return null;

            const nearbyUsers = await getNearbyUsers(
              currentUserLocation.latitude,
              currentUserLocation.longitude,
              senderRadius,
            );

            if (!nearbyUsers || nearbyUsers.length === 0) return null;

            const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
            const visibleNearbyUsers = nearbyUsers.filter(
              (id) => !blockedUserIds.has(id)
            );

            const usersToBroadCastTo = await filterMutuallyNearbyUsers(
              user.id,
              currentUserLocation,
              visibleNearbyUsers,
              userSocketMap,
            );

            return usersToBroadCastTo;
          })(),
        ]);

        if (!message) {
          return socket.emit("error", "Failed to create proximity message");
        }

        if (!broadcastPrep) {
          return socket.emit("error", "no one nearby");
        }

        const messageToSend = {
          ...message,
          content: message.content,
          senderDisplayId: message.sender.displayId,
          timestamp: message.createdAt,
          messageId: message.id,
          userId: user.id,
        };

        if (Array.isArray(broadcastPrep)) {
          broadcastPrep.forEach((socketId) => {
            io.to(socketId).emit("receiveProximityMessage", messageToSend);
          });
        } else if (typeof broadcastPrep === "string") {
          io.to(broadcastPrep).emit("receiveProximityMessage", messageToSend);
        }

        // Enqueue moderation in background (fire-and-forget)
        enqueueModerationJob({
          contentType: "PROXIMITY_MESSAGE",
          contentId: message.id,
          userId: user.id,
          text: content,
          imageUrl: message.imageUrl ?? undefined,
          socketMeta: {
            type: "PROXIMITY_MESSAGE",
            latitude,
            longitude,
            senderRadius,
          },
        });
      } catch (error: any) {
        console.error("[sendProximityMessage] Error:", error);
        socket.emit("error", "An unexpected error has occurred");
      }
    },
  );

  socket.on("disconnect", () => {
    removeUserLocation(user.id);
    console.log(`User ${user.displayId} has been removed from redis server`);
  });
}