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
import { getAllBlockRelatedUserIdsDao } from "../dao/BlockDao";
import { isUserSuspended } from "../services/userService";

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
  socket.on("updateLocation", async ({ latitude, longitude }) => {
    try {
      await saveUserLocation(user.id, { latitude, longitude });

      const senderRadius = userSocketMap[user.id]?.proximityRadius ?? 1600;
      const nearbyUserIds = await getNearbyUsers(latitude, longitude, senderRadius);

      // Filter out blocked users before counting nearby users
      const blockedUserIds = new Set(await getAllBlockRelatedUserIdsDao(user.id));
      const visibleNearbyUserIds = nearbyUserIds.filter(
        (id) => id !== user.id && !blockedUserIds.has(id)
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
      const blockedUserIds = new Set(await getAllBlockRelatedUserIdsDao(user.id));
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

        // Block suspended users from sending proximity messages
        if (await isUserSuspended(user as any)) {
          const until = (user as any).suspendedUntil as Date;
          return socket.emit("error", `Your account is suspended until ${until.toUTCString()}`);
        }

        const message = await proximityMessageService.createProximityMessage(
          user.id,
          content,
          latitude,
          longitude,
          imageUrl,
        );

        if (!message) {
          return socket.emit("error", "Failed to create proximity message");
        }

        const currentUserLocation = await getUserLocation(String(user.id));
        if (!currentUserLocation) {
          return socket.emit("error", "Action not Authorized");
        }

        const messageToSend = {
          ...message,
          content: message.content,
          senderDisplayId: message.sender.displayId,
          timestamp: message.createdAt,
          messageId: message.id,
          userId: user.id,
        };

        const nearbyUsers = await getNearbyUsers(
          currentUserLocation.latitude,
          currentUserLocation.longitude,
          user.preferences?.proximityRadius ?? 500,
        );

        if (!nearbyUsers || nearbyUsers.length === 0) {
          return socket.emit("error", "no one nearby");
        }

        // Filter out blocked users before determining who to broadcast to
        const blockedUserIds = new Set(await getAllBlockRelatedUserIdsDao(user.id));
        const visibleNearbyUsers = nearbyUsers.filter(
          (id) => !blockedUserIds.has(id)
        );

        const usersToBroadCastTo = await filterMutuallyNearbyUsers(
          user.id,
          currentUserLocation,
          visibleNearbyUsers,
          userSocketMap,
        );

        if (Array.isArray(usersToBroadCastTo)) {
          usersToBroadCastTo.forEach((socketId) => {
            io.to(socketId).emit("receiveProximityMessage", messageToSend);
          });
        } else if (typeof usersToBroadCastTo === "string") {
          io.to(usersToBroadCastTo).emit("receiveProximityMessage", messageToSend);
        }
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