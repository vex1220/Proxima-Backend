import { DirectMessage } from "@prisma/client";
import { DirectMessageDao } from "../dao/DirectMessageDao";
import { AbstractMessageService } from "./abstractClasses/abstractMessageService";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";

const directMessageDao = new DirectMessageDao();

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export class DirectMessageService extends AbstractMessageService<DirectMessage | null> {
  constructor() {
    super(directMessageDao);
  }

  async editMessage(messageId: number, userId: number, content: string) {
    const message = await directMessageDao.getMessageById(messageId);
    if (!message) throw new Error("Message not found");
    if (message.senderId !== userId) throw new Error("Not authorized to edit this message");
    if (message.deleted) throw new Error("Cannot edit a deleted message");
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new Error("Messages can only be edited within 15 minutes of sending");
    }
    return directMessageDao.updateMessage(messageId, content);
  }

  async createDirectMessage(
    conversationId: number,
    senderId: number,
    content: string,
    imageUrl?: string,
    replyToId?: number,
    wasAnonymous?: boolean,
  ) {
    if (replyToId != null) {
      const parentMessage = await directMessageDao.getMessageById(replyToId);
      if (!parentMessage) {
        throw new Error("The message you are replying to does not exist");
      }
      if (parentMessage.conversationId !== conversationId) {
        throw new Error("Cannot reply to a message in a different conversation");
      }
      if (parentMessage.deleted) {
        throw new Error("Cannot reply to a deleted message");
      }
    }

    return directMessageDao.createDirectMessage(
      conversationId,
      senderId,
      content,
      imageUrl,
      replyToId,
      wasAnonymous,
    );
  }

  async softDeleteMessage(messageId: number, userId: number) {
    const message = await directMessageDao.getMessageById(messageId);
    if (!message) throw new Error("Message not found");
    if (message.senderId !== userId) throw new Error("Not authorized to delete this message");
    return directMessageDao.deleteMessage(messageId);
  }

  async getReplyDataById(replyToId: number) {
    return directMessageDao.getReplyDataById(replyToId);
  }

  async getMessageHistory(
    conversationId: number,
    userId: number,
    limit: number = 50,
    cursor?: number,
  ) {
    const messages = await directMessageDao.getMessageHistory(
      conversationId,
      limit,
      cursor,
    );

    const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(userId));

    return messages
      .filter((msg) => !blockedUserIds.has(msg.senderId))
      .map((msg) => ({
        ...msg,
        content: msg.deleted ? "Message Has Been Deleted" : msg.content,
        editedAt: msg.deleted ? null : msg.editedAt ?? null,
        isOwnMessage: msg.senderId === userId,
        sender: {
          ...msg.sender,
          displayId: msg.sender.deleted
            ? "User no Longer exists"
            : msg.wasAnonymous
            ? "Anonymous"
            : msg.sender.displayId,
        },
        replyTo: msg.replyTo
          ? {
              id: msg.replyTo.id,
              content: msg.replyTo.deleted
                ? "Message Has Been Deleted"
                : msg.replyTo.content,
              imageUrl: msg.replyTo.deleted ? null : msg.replyTo.imageUrl,
              senderDisplayId: msg.replyTo.wasAnonymous
                ? "Anonymous"
                : msg.replyTo.sender.displayId,
            }
          : null,
      }));
  }
}
