import { prisma } from "../utils/prisma";
import type { DmOriginSnapshot } from "../services/dmOriginService";

function canonicalPair(userAId: number, userBId: number): [number, number] {
  return userAId < userBId ? [userAId, userBId] : [userBId, userAId];
}

// Shapes the denormalized origin columns into the `origin` object the client renders,
// or null when the conversation has no recorded origin (created before this feature, or
// started without a content context such as from a voice participant).
function shapeOrigin(c: {
  originType: any;
  originId: number | null;
  originText: string | null;
  originImageUrl: string | null;
  originAuthorDisplayId: string | null;
  originLabel: string | null;
}) {
  if (!c.originType || c.originId == null) return null;
  return {
    type: c.originType,
    id: c.originId,
    text: c.originText,
    imageUrl: c.originImageUrl,
    authorDisplayId: c.originAuthorDisplayId,
    label: c.originLabel,
  };
}

export async function getOrCreateConversation(
  initiatorId: number,
  otherUserId: number,
  origin?: DmOriginSnapshot | null,
) {
  const [participantAId, participantBId] = canonicalPair(initiatorId, otherUserId);

  const existing = await prisma.directConversation.findUnique({
    where: { participantAId_participantBId: { participantAId, participantBId } },
  });
  if (existing) return existing;

  const recipientSettings = await prisma.user_Settings.findUnique({
    where: { userId: otherUserId },
    select: { anonymousMode: true },
  });
  const recipientWasAnonymous = recipientSettings?.anonymousMode ?? false;

  return prisma.directConversation.create({
    data: {
      initiatorId,
      participantAId,
      participantBId,
      recipientWasAnonymous,
      ...(origin
        ? {
            originType: origin.originType,
            originId: origin.originId,
            originText: origin.originText,
            originImageUrl: origin.originImageUrl,
            // Finalize masking: hide the author if the content was anonymous OR the
            // recipient is in anonymous mode, so the stored label never leaks a name.
            originAuthorDisplayId:
              origin.contentWasAnonymous || recipientWasAnonymous
                ? "Anonymous"
                : origin.authorDisplayId,
            originLabel: origin.originLabel,
          }
        : {}),
    },
  });
}

export async function getConversationById(id: number) {
  const conversation = await prisma.directConversation.findUnique({
    where: { id },
    include: {
      participantA: { select: { id: true, displayId: true, deleted: true } },
      participantB: { select: { id: true, displayId: true, deleted: true } },
    },
  });
  if (!conversation) return null;
  return { ...conversation, origin: shapeOrigin(conversation) };
}

export async function getConversationByParticipants(userAId: number, userBId: number) {
  const [participantAId, participantBId] = canonicalPair(userAId, userBId);
  return prisma.directConversation.findUnique({
    where: { participantAId_participantBId: { participantAId, participantBId } },
  });
}

export async function getInboxForUser(userId: number) {
  const conversations = await prisma.directConversation.findMany({
    where: {
      OR: [{ participantAId: userId }, { participantBId: userId }],
    },
    include: {
      participantA: { select: { id: true, displayId: true, deleted: true } },
      participantB: { select: { id: true, displayId: true, deleted: true } },
      messages: {
        where: { deleted: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          content: true,
          imageUrl: true,
          createdAt: true,
          senderId: true,
          wasAnonymous: true,
          sender: { select: { displayId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return conversations
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => {
      const aTime = a.messages[0]?.createdAt.getTime() ?? 0;
      const bTime = b.messages[0]?.createdAt.getTime() ?? 0;
      return bTime - aTime;
    })
    .map((c) => {
      const lastMsg = c.messages[0];
      const isA = c.participantAId === userId;
      const lastReadId = isA ? c.lastReadMsgIdA : c.lastReadMsgIdB;

      const otherUser = isA ? c.participantB : c.participantA;
      const isInitiator = c.initiatorId === userId;
      const maskedOtherUser = isInitiator && c.recipientWasAnonymous
        ? { ...otherUser, displayId: "Anonymous" }
        : otherUser;

      return {
        id: c.id,
        status: c.status,
        initiatorId: c.initiatorId,
        otherUser: maskedOtherUser,
        origin: shapeOrigin(c),
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.content,
              imageUrl: lastMsg.imageUrl,
              createdAt: lastMsg.createdAt,
              senderDisplayId: lastMsg.wasAnonymous
                ? "Anonymous"
                : lastMsg.sender.displayId,
              isOwn: lastMsg.senderId === userId,
            }
          : null,
        unreadCount: lastMsg && lastMsg.senderId !== userId
          ? (lastReadId ? (lastMsg.id > lastReadId ? 1 : 0) : 1)
          : 0,
      };
    });
}

export async function getUnreadCountForConversation(
  conversationId: number,
  userId: number,
  lastReadMsgId: number | null,
): Promise<number> {
  return prisma.directMessage.count({
    where: {
      conversationId,
      deleted: false,
      senderId: { not: userId },
      ...(lastReadMsgId ? { id: { gt: lastReadMsgId } } : {}),
    },
  });
}

export async function acceptConversation(conversationId: number) {
  return prisma.directConversation.update({
    where: { id: conversationId },
    data: { status: "ACCEPTED" },
  });
}

export async function markConversationRead(
  conversationId: number,
  userId: number,
  lastMessageId: number,
) {
  const conv = await prisma.directConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) return null;

  const isA = conv.participantAId === userId;
  return prisma.directConversation.update({
    where: { id: conversationId },
    data: isA
      ? { lastReadMsgIdA: lastMessageId }
      : { lastReadMsgIdB: lastMessageId },
  });
}

export async function deleteConversation(conversationId: number) {
  return prisma.directConversation.delete({
    where: { id: conversationId },
  });
}
