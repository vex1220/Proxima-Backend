import { Server, Socket } from "socket.io";
import { User } from "@prisma/client";
import {getLastFiftyMessages} from "../services/chatRoomService";
import { ChatRoomMessageService } from "../services/ChatRoomMessageService";
import { updateUserKarma } from "../services/userService";
import { VoteService } from "../services/VoteService";
import { getAndVerifyMessage,verifyChatRoomAndUserInRange } from "../utils/chatRoomSocketUtils";
import { VoteModel, Vote } from "../models/voteTypes";
import { constructVote, validateNotOwnPost } from "../utils/voteUtils";

function getUserCount(io: Server, roomId: string) {
  const room = io.sockets.adapter.rooms.get(roomId);
  return room ? room.size : 0;
}

const chatRoomMessageService = new ChatRoomMessageService();
const voteService = new VoteService(VoteModel.ChatRoomMessageVote);

export function setupChatRoomSocket(io: Server, socket: Socket, user: User) {
  socket.on("joinRoom", async (roomId: number) => {
    try{
      const chatRoom = await verifyChatRoomAndUserInRange(roomId,user.id);

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
  } catch (error:any){
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

  socket.on("sendMessage", async ({ roomId, content }) => {
    try {

      const chatRoom = await verifyChatRoomAndUserInRange(roomId,user.id);

      const message = await chatRoomMessageService.createChatRoomMessage(
        chatRoom.id,
        user.id,
        content,
      );

      const messageToSend = {
        ...message,
        chatRoomId: chatRoom.id,
        content: message.content,
        senderDisplayId: message.sender.displayId,
        timestamp: message.createdAt,
        messageId: message.id,
        userId: user.id,
      };

      io.to(String(chatRoom.id)).emit("receiveMessage", messageToSend);
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occured");
    }
  });

  socket.on("deleteMessage", async ({ roomId, messageId }) => {
    try {
      const chatRoom = await verifyChatRoomAndUserInRange(roomId,user.id);
      const message = await getAndVerifyMessage(messageId);

      if (user.id !== message.senderId && !user.isAdmin) {
        return socket.emit("error", "Action not Authorized");
      }

      await chatRoomMessageService.deleteMessage(messageId);

      const updatedMessage = await chatRoomMessageService.getMessageById(
        messageId,
      );

      io.to(String(chatRoom.id)).emit("updateMessage", updatedMessage);
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occured");
    }
  });

  socket.on("voteMessage", async ({ roomId, messageId, value }) => {
    try {
      const chatRoom = await verifyChatRoomAndUserInRange(roomId,user.id);
      const message = await getAndVerifyMessage(messageId);

      validateNotOwnPost(user.id,message.senderId);

      // Always fetch existing vote first so we can compute the karma delta
      const existingVote = await voteService.getVote(
        constructVote(0, user.id, message.id)
      );
      const oldValue = existingVote?.value ?? 0;

      if(value == 0){
        // Removing vote — reverse the old karma
        if (existingVote) {
          await voteService.removeVote(constructVote(0, user.id, message.id));
          await updateUserKarma(message.senderId, -oldValue);
        }
      }else{
        // Creating or changing vote — apply the delta
        const vote : Vote = constructVote(value,user.id,message.id)
        await voteService.voteOnMessage(vote);

        const karmaDelta = value - oldValue;
        if (karmaDelta !== 0) {
          await updateUserKarma(message.senderId, karmaDelta);
        }
      }

      const voteCount = await voteService.getVoteCount(messageId);

      const updatedMessage = {
        ...message,
        voteCount,
      };

      io.to(String(chatRoom.id)).emit("updateMessage", updatedMessage);
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occured");
    }
  });
}