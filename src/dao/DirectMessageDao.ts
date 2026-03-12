import { prisma } from "../utils/prisma";
import { DirectMessage } from "@prisma/client";
import { AbstractMessageDao } from "./abstractClasses/abstractMessageDao";

export class DirectMessageDao extends AbstractMessageDao<DirectMessage | null> {
  async getMessageById(messageId: number): Promise<DirectMessage | null> {
    return prisma.directMessage.findUnique({
      where: { id: messageId },
    });
  }

  async updateMessage(messageId: number, content: string): Promise<DirectMessage | null> {
    return prisma.directMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });
  }

  async deleteMessage(messageId: number): Promise<DirectMessage | null> {
    return prisma.directMessage.update({
      where: { id: messageId },
      data: { deleted: true },
    });
  }

  async deleteMessageByUser(senderId: number): Promise<number> {
    return prisma.directMessage
      .updateMany({
        where: { senderId },
        data: { deleted: true },
      })
      .then((result) => result.count);
  }

  async createDirectMessage(
    conversationId: number,
    senderId: number,
    content: string,
    imageUrl?: string,
    replyToId?: number,
    wasAnonymous?: boolean,
  ) {
    return prisma.directMessage.create({
      data: {
        conversationId,
        senderId,
        content,
        imageUrl: imageUrl ?? null,
        replyToId: replyToId ?? null,
        wasAnonymous: wasAnonymous ?? false,
      },
    });
  }

  async getReplyDataById(replyToId: number) {
    return prisma.directMessage.findUnique({
      where: { id: replyToId },
      select: {
        id: true,
        content: true,
        deleted: true,
        imageUrl: true,
        wasAnonymous: true,
        conversationId: true,
        sender: { select: { displayId: true } },
      },
    });
  }

  async getMessageHistory(
    conversationId: number,
    limit: number = 50,
    cursor?: number,
  ) {
    return prisma.directMessage.findMany({
      where: {
        conversationId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        content: true,
        imageUrl: true,
        conversationId: true,
        senderId: true,
        replyToId: true,
        deleted: true,
        wasAnonymous: true,
        editedAt: true,
        sender: { select: { displayId: true, deleted: true } },
        replyTo: {
          select: {
            id: true,
            content: true,
            deleted: true,
            imageUrl: true,
            wasAnonymous: true,
            sender: { select: { displayId: true } },
          },
        },
      },
    });
  }
}
