import { Server } from "socket.io";
import { userFromAccessToken } from "../services/authService";
import { setupChatRoomSocket } from "./chatRoomSocket";
import { UserWithPreferences } from "../models/userTypes";
import { setupProximitySocket } from "./proximitySocket";
import { removeUserLocation } from "../utils/redisUserLocation";
import { clearSession } from "../utils/redisSession";

const userSocketMap: {
  [userId: number]: {
    socketId: string;
    proximityRadius: number;
  };
} = {};

export function setupSocket(io: Server) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("No token provided"));
      }

      const user = (await userFromAccessToken(token)) as UserWithPreferences;
      if (!user) {
        return next(new Error("User no longer exists"));
      }

      if (!user.isVerified) {
        return next(new Error("User email is not verified"));
      }
      if (user.deleted) {
        return next(new Error("User no longer exists"));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.user as UserWithPreferences;
    if (!user) {
      return new Error("User no longer exists");
    }

    userSocketMap[user.id] = {
      socketId: socket.id,
      proximityRadius: user.preferences?.proximityRadius ?? 8047,
    };

    // Join a personal room so the moderation worker can emit targeted events
    socket.join(`user:${user.id}`);

    console.log(`User ${user.displayId} connected via WebSocket`);

    // Both socket handlers now receive the userSocketMap for block filtering
    setupChatRoomSocket(io, socket, user, userSocketMap);
    setupProximitySocket(io, socket, user, userSocketMap);

    socket.on("disconnect", () => {
      delete userSocketMap[user.id];
      clearSession(user.id).catch(() => {});
      console.log(`User ${user.displayId} disconnected`);
    });
  });
}