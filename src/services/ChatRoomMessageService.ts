import { User, ChatRoomMessage } from "@prisma/client";
import { ChatRoomMessageDao } from "../dao/ChatRoomMessageDao";
import { AbstractMessageService } from "./abstractClasses/abstractMessageService";
import { AbstractMessageDao } from "../dao/abstractClasses/abstractMessageDao";

const chatRoomMessageDao = new ChatRoomMessageDao();

export class ChatRoomMessageService extends AbstractMessageService<ChatRoomMessage | null> {
  constructor() {
    super(chatRoomMessageDao);
  }

  async getMessageById(messageId: number): Promise<ChatRoomMessage | null> {
    return chatRoomMessageDao.getMessageById(messageId);
  }

  async updateMessage(
    messageId: number,
    content: string,
  ): Promise<ChatRoomMessage | null> {
    return chatRoomMessageDao.updateMessage(messageId, content);
  }

  async deleteMessageByUser(senderId: number): Promise<number> {
    return chatRoomMessageDao.deleteMessageByUser(senderId);
  }

  async createChatRoomMessage(
    chatRoomId: number,
    senderId: number,
    content: string,
    imageUrl?: string,
    replyToId?: number,
  ) {
    // If replying, verify the parent message exists and belongs to this chatroom
    if (replyToId != null) {
      const parentMessage = await chatRoomMessageDao.getMessageById(replyToId);
      if (!parentMessage) {
        throw new Error("The message you are replying to does not exist");
      }
      if (parentMessage.chatRoomId !== chatRoomId) {
        throw new Error("Cannot reply to a message in a different chatroom");
      }
      if (parentMessage.deleted) {
        throw new Error("Cannot reply to a deleted message");
      }
    }

    return await chatRoomMessageDao.createChatRoomMessage(
      chatRoomId,
      senderId,
      content,
      imageUrl,
      replyToId,
    );
  }

  async deleteChatRoomMessagesByChatroom(chatroomId: number) {
    return await chatRoomMessageDao.deleteChatRoomMessagesByChatroom(
      chatroomId,
    );
  }

  async getLatestChatRoomMessagesByChatRoom(
    chatRoomId: number,
    count: number,
  ) {
    const messages =
      await chatRoomMessageDao.getLatestChatRoomMessagesByChatRoom(
        chatRoomId,
        count,
      );
    return messages.map((msg) => ({
      ...msg,
      content: msg.deleted
        ? "ChatRoomMessage Has Been Deleted"
        : msg.content,
      sender: {
        ...msg.sender,
        displayId: msg.sender.deleted
          ? "User no Longer exists"
          : msg.sender.displayId,
      },
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            content: msg.replyTo.deleted
              ? "Message Has Been Deleted"
              : msg.replyTo.content,
            imageUrl: msg.replyTo.deleted ? null : msg.replyTo.imageUrl,
            sender: msg.replyTo.sender,
          }
        : null,
    }));
  }

  async getMessageCountByUser(userId: number) {
    return await chatRoomMessageDao.getMessageCountByUser(userId);
  }
}