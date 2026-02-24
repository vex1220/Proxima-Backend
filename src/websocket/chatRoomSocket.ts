import { Server, Socket } from "socket.io";
import { User } from "@prisma/client";
import { getLastFiftyMessages } from "../services/chatRoomService";
import { ChatRoomMessageService } from "../services/ChatRoomMessageService";
import { updateUserKarma } from "../services/userService";
import { VoteService } from "../services/VoteService";
import { getAndVerifyMessage, verifyChatRoomAndUserInRange } from "../utils/chatRoomSocketUtils";
import { VoteModel, Vote } from "../models/voteTypes";
import { constructVote, validateNotOwnPost } from "../utils/voteUtils";
import { validateImageUrl } from "../utils/validateImageUrl";
import { getAllBlockRelatedUserIdsDao } from "../dao/BlockDao";
import { isUserSuspended } from "../services/userService";

function getUserCount(io: Server, roomId: string) {
  const room = io.sockets.adapter.rooms.get(roomId);
  return room ? room.size : 0;
}

const chatRoomMessageService = new ChatRoomMessageService();
const voteService = new VoteService(VoteModel.ChatRoomMessageVote);

export function setupChatRoomSocket(
  io: Server,
  socket: Socket,
  user: User,
  userSocketMap: { [userId: number]: { socketId: string; proximityRadius: number } },
) {
  socket.on("joinRoom", async (roomId: number) => {
    try {
      const chatRoom = await verifyChatRoomAndUserInRange(roomId, user.id);

      socket.join(String(roomId));

      const userCount = getUserCount(io, String(roomId));

      io.to(String(roomId)).emit("userJoined", {
        displayId: user.displayId,
        chatRoom: chatRoom.name,
        userCount,
        message: `${user.displayId} has joined room ${chatRoom.name}`,
      });

      const lastMessages = await getLastFiftyMessages(roomId, user.id);
      socket.emit("joinedRoom", { chatRoom, lastMessages });
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occurred");
    }
  });

  socket.on("leaveRoom", () => {
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        const userCount = getUserCount(io, roomId) - 1;
        io.to(roomId).emit("userLeft", {
          userCount,
          displayId: user.displayId,
          message: `${user.displayId} has left the room`,
        });
        socket.leave(roomId);
      }
    });
  });

  socket.on("disconnecting", () => {
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        const userCount = getUserCount(io, roomId) - 1;
        io.to(roomId).emit("userLeft", {
          userCount,
          displayId: user.displayId,
          message: `${user.displayId} has left the room`,
        });
      }
    });
  });

  socket.on("sendMessage", async ({ roomId, content, imageUrl: rawImageUrl, replyToId }) => {
    try {
      const imageUrl = validateImageUrl(rawImageUrl) ?? undefined;

      // Block suspended users from sending messages
      if (await isUserSuspended(user as any)) {
        const until = (user as any).suspendedUntil as Date;
        return socket.emit("error", `Your account is suspended until ${until.toUTCString()}`);
      }

      const chatRoom = await verifyChatRoomAndUserInRange(roomId, user.id);

      const message = await chatRoomMessageService.createChatRoomMessage(
        chatRoom.id,
        user.id,
        content,
        imageUrl,
        replyToId ?? undefined,
      );

      const messageToSend = {
        ...message,
        chatRoomId: chatRoom.id,
        content: message.content,
        imageUrl: message.imageUrl,
        senderDisplayId: message.sender.displayId,
        timestamp: message.createdAt,
        messageId: message.id,
        userId: user.id,
        isReply: message.isReply,
        replyToId: message.replyToId,
        replyTo: message.replyTo
          ? {
              id: message.replyTo.id,
              content: message.replyTo.deleted
                ? "Message Has Been Deleted"
                : message.replyTo.content,
              senderDisplayId: message.replyTo.sender.displayId,
            }
          : null,
      };

      // Build a reverse map: socketId → userId for block filtering
      const socketToUserId: { [socketId: string]: number } = {};
      for (const [uid, entry] of Object.entries(userSocketMap)) {
        socketToUserId[entry.socketId] = Number(uid);
      }

      // Get all user IDs with a block relationship with the sender
      const blockedUserIds = new Set(await getAllBlockRelatedUserIdsDao(user.id));

      // Deliver individually, skipping blocked users
      const roomSockets = io.sockets.adapter.rooms.get(String(chatRoom.id));
      if (roomSockets) {
        for (const socketId of roomSockets) {
          const recipientUserId = socketToUserId[socketId];
          if (recipientUserId !== undefined && blockedUserIds.has(recipientUserId)) {
            continue; // skip — block relationship exists
          }
          io.to(socketId).emit("receiveMessage", messageToSend);
        }
      }
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occurred");
    }
  });

  socket.on("deleteMessage", async ({ roomId, messageId }) => {
    try {
      const chatRoom = await verifyChatRoomAndUserInRange(roomId, user.id);
      const message = await getAndVerifyMessage(messageId);

      if (user.id !== message.senderId && !user.isAdmin) {
        return socket.emit("error", "Action not Authorized");
      }

      await chatRoomMessageService.deleteMessage(messageId);
      const updatedMessage = await chatRoomMessageService.getMessageById(messageId);
      io.to(String(chatRoom.id)).emit("updateMessage", updatedMessage);
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occurred");
    }
  });

  socket.on("voteMessage", async ({ roomId, messageId, value }) => {
    try {
      const chatRoom = await verifyChatRoomAndUserInRange(roomId, user.id);
      const message = await getAndVerifyMessage(messageId);

      validateNotOwnPost(user.id, message.senderId);

      const existingVote = await voteService.getVote(
        constructVote(0, user.id, message.id)
      );
      const oldValue = existingVote?.value ?? 0;

      if (value == 0) {
        if (existingVote) {
          await voteService.removeVote(constructVote(0, user.id, message.id));
          await updateUserKarma(message.senderId, -oldValue);
        }
      } else {
        const vote: Vote = constructVote(value, user.id, message.id);
        await voteService.voteOnMessage(vote);
        const karmaDelta = value - oldValue;
        if (karmaDelta !== 0) {
          await updateUserKarma(message.senderId, karmaDelta);
        }
      }

      const voteCount = await voteService.getVoteCount(messageId);
      const updatedMessage = { ...message, voteCount };
      io.to(String(chatRoom.id)).emit("updateMessage", updatedMessage);
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occurred");
    }
  });

  socket.on("typing", ({ roomId, isTyping }) => {
    socket.to(String(roomId)).emit("userTyping", {
      displayId: user.displayId,
      isTyping,
    });
  });
}