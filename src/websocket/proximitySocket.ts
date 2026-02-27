import { Server, Socket } from "socket.io";
import {
  getNearbyUsers,
  saveUserLocation,
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
  let lastCountCalcTime = 0;
  const COUNT_THROTTLE_MS = 10_000;

  // Cached mutual user IDs — refreshed every 10s by updateLocation.
  // The proximityTyping handler reads from this instead of hitting Redis.
  let cachedMutualUserIds: number[] = [];

  // Track previous mutual set for join/leave detection
  let previousMutualUserIds = new Set<number>();

  const getDisplayName = () =>
    user.preferences?.anonymousMode ? "Anonymous" : user.displayId;

  socket.on("updateLocation", async ({ latitude, longitude }) => {
    try {
      await saveUserLocation(user.id, { latitude, longitude });

      const now = Date.now();
      if (now - lastCountCalcTime < COUNT_THROTTLE_MS) return;
      lastCountCalcTime = now;

      const senderRadius = userSocketMap[user.id]?.proximityRadius ?? 1600;
      const nearbyUserIds = await getNearbyUsers(latitude, longitude, senderRadius);

      const connectedNearbyIds = nearbyUserIds.filter(
        (id) => id !== user.id && userSocketMap[id] != null
      );

      const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
      const visibleNearbyUserIds = connectedNearbyIds.filter(
        (id) => !blockedUserIds.has(id)
      );

      const mutualUserIds = await filterMutuallyNearbyUsers(
        user.id,
        { latitude, longitude },
        visibleNearbyUserIds,
        userSocketMap,
      );

      // Update cached set for typing handler
      cachedMutualUserIds = mutualUserIds;

      // Detect joins and leaves
      const currentSet = new Set(mutualUserIds);
      const displayName = getDisplayName();

      for (const id of mutualUserIds) {
        if (!previousMutualUserIds.has(id)) {
          // New user entered mutual range
          socket.emit("proximityUserJoined", { displayId: String(id) });
          io.to(`user:${id}`).emit("proximityUserJoined", { displayId: displayName });
        }
      }

      for (const id of previousMutualUserIds) {
        if (!currentSet.has(id)) {
          // User left mutual range
          socket.emit("proximityUserLeft", { displayId: String(id) });
          io.to(`user:${id}`).emit("proximityUserLeft", { displayId: displayName });
        }
      }

      previousMutualUserIds = currentSet;

      socket.emit("nearbyUserCount", { count: mutualUserIds.length });
    } catch (error: any) {
      socket.emit("error", "An unexpected error has occurred");
    }
  });

  socket.on("proximityTyping", ({ isTyping }) => {
    const displayId = getDisplayName();
    cachedMutualUserIds.forEach((id) => {
      io.to(`user:${id}`).emit("nearbyUserTyping", { displayId, isTyping });
    });
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

        const { suspended, until: suspendedUntil } = await isUserSuspendedById(user.id);
        if (suspended) {
          return socket.emit("suspended", { suspendedUntil: suspendedUntil!.toISOString() });
        }

        const senderRadius = user.preferences?.proximityRadius ?? 500;
        const currentUserLocation = { latitude, longitude };

        const [message, broadcastPrep] = await Promise.all([
          proximityMessageService.createProximityMessage(
            user.id,
            content,
            latitude,
            longitude,
            imageUrl,
          ),
          (async () => {
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

            const usersToBroadcastTo = await filterMutuallyNearbyUsers(
              user.id,
              currentUserLocation,
              visibleNearbyUsers,
              userSocketMap,
            );

            return usersToBroadcastTo;
          })(),
        ]);

        if (!message) {
          return socket.emit("error", "Failed to create proximity message");
        }

        if (!broadcastPrep) {
          return socket.emit("error", "no one nearby");
        }

        const wasAnonymous = user.preferences?.anonymousMode ?? true;
        const messageToSend = {
          ...message,
          content: message.content,
          senderDisplayId: wasAnonymous ? "Anonymous" : message.sender.displayId,
          timestamp: message.createdAt,
          messageId: message.id,
          userId: user.id,
        };

        broadcastPrep.forEach((userId) => {
          io.to(`user:${userId}`).emit("receiveProximityMessage", messageToSend);
        });

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
    const displayName = getDisplayName();
    for (const id of previousMutualUserIds) {
      io.to(`user:${id}`).emit("proximityUserLeft", { displayId: displayName });
    }
    removeUserLocation(user.id);
    console.log(`User ${user.displayId} has been removed from redis server`);
  });
}
