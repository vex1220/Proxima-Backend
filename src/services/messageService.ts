import { User, Message } from "@prisma/client";
import {
  createMessageDao,
  deleteMessageDao,
  deleteMessagesByChatroomDao,
  deleteMessagesByUserDao,
  getLatestMessagesByChatRoomDao,
} from "../dao/messageDao";
import { get } from "http";

export async function createMessage(
  chatRoomId: number,
  senderId: number,
  content: string,
) {
  return await createMessageDao(chatRoomId, senderId, content);
}

export async function deleteMessage(message: Message, user: User) {
  if (message.senderId != user.id && !user.isAdmin) {
    throw new Error("Cannot delete this message");
  }
  return await deleteMessageDao(message.id);
}

export async function deleteMessagesByChatroom(chatroomId: number) {
  return await deleteMessagesByChatroomDao(chatroomId);
}

export async function deleteMessagesByUser(user: User) {
  return await deleteMessagesByUserDao(user.id);
}

export async function getLastestMessagesByChatRoom(
  chatRoomId: number,
  count: number,
): Promise<(Message & { sender: { displayId: string } })[]> {
  const messages = await getLatestMessagesByChatRoomDao(chatRoomId, count);
  return messages.map((message) => ({
    ...message,
    sender: {
      ...message.sender,
      displayId: message.sender.deleted
        ? "User no Longer exists"
        : message.sender.displayId,
    },
  }));
}
