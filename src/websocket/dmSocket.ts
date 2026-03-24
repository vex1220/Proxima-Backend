import { Server, Socket } from "socket.io";
import { UserWithPreferences } from "../models/userTypes";
import { DirectMessageService } from "../services/DirectMessageService";
import { getConversationById, markConversationRead } from "../dao/DirectConversationDao";
import { validateImageUrl } from "../utils/validateImageUrl";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";
import { getCachedSuspensionStatus } from "../utils/redisSuspension";
import { sendPushToUser } from "../notifications/pushService";
import { createNotification } from "../notifications/notificationDao";
import { getNotificationPreferencesDao } from "../dao/userServiceDao";

const directMessageService = new DirectMessageService();

const DM_RATE_LIMIT_WINDOW = 60_000;
const DM_RATE_LIMIT_MAX = 30;
const dmSendTimestamps = new Map<number, number[]>();

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of dmSendTimestamps) {
    const recent = timestamps.filter((t) => now - t < DM_RATE_LIMIT_WINDOW);
    if (recent.length === 0) dmSendTimestamps.delete(userId);
    else dmSendTimestamps.set(userId, recent);
  }
}, 60_000);

function checkDMRateLimit(userId: number): boolean {
  const now = Date.now();
  const timestamps = dmSendTimestamps.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < DM_RATE_LIMIT_WINDOW);
  if (recent.length >= DM_RATE_LIMIT_MAX) return false;
  recent.push(now);
  dmSendTimestamps.set(userId, recent);
  return true;
}

export function setupDMSocket(
  io: Server,
  socket: Socket,
  user: UserWithPreferences,
  userSocketMap: { [userId: number]: { socketId: string; proximityRadius: number } },
) {
  let cachedSuspension: { suspended: boolean; until: Date | null } | null = null;
  let suspensionCachedAt = 0;
  const SUSPENSION_CACHE_TTL = 300_000;

  let cachedBlockedUserIds: Set<number> | null = null;
  let blockListCachedAt = 0;
  const BLOCK_LIST_CACHE_TTL = 60_000;

  socket.on("joinDMConversation", async ({ conversationId }) => {
    try {
      const conversation = await getConversationById(conversationId);
      if (!conversation) return;

      const isParticipant =
        conversation.participantAId === user.id ||
        conversation.participantBId === user.id;
      if (!isParticipant) return;

      socket.join(`dm:${conversationId}`);
    } catch {
      // silent
    }
  });

  socket.on("leaveDMConversation", ({ conversationId }) => {
    socket.leave(`dm:${conversationId}`);
  });

  socket.on("sendDM", async ({ conversationId, content, imageUrl: rawImageUrl, replyToId, tempId }) => {
    try {
      const imageUrl = validateImageUrl(rawImageUrl) ?? undefined;

      if ((!content && !imageUrl) || (content && content.length > 2000)) {
        socket.emit("error", "Invalid message");
        return;
      }

      if (!checkDMRateLimit(user.id)) {
        return socket.emit("dmRateLimited", { retryAfterMs: DM_RATE_LIMIT_WINDOW });
      }

      const now = Date.now();
      if (!cachedSuspension || now - suspensionCachedAt > SUSPENSION_CACHE_TTL) {
        cachedSuspension = await getCachedSuspensionStatus(user.id);
        suspensionCachedAt = now;
      }
      if (cachedSuspension.suspended) {
        return socket.emit("suspended", { suspendedUntil: cachedSuspension.until!.toISOString() });
      }

      const conversation = await getConversationById(conversationId);
      if (!conversation) {
        return socket.emit("error", "Conversation not found");
      }

      const isParticipant =
        conversation.participantAId === user.id ||
        conversation.participantBId === user.id;
      if (!isParticipant) {
        return socket.emit("error", "Not a participant");
      }

      if (conversation.status === "PENDING" && conversation.initiatorId !== user.id) {
        return socket.emit("error", "You must accept the conversation before sending messages");
      }

      const otherUserId =
        conversation.participantAId === user.id
          ? conversation.participantBId
          : conversation.participantAId;

      const now2 = Date.now();
      if (!cachedBlockedUserIds || now2 - blockListCachedAt > BLOCK_LIST_CACHE_TTL) {
        cachedBlockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
        blockListCachedAt = now2;
      }
      if (cachedBlockedUserIds.has(otherUserId)) {
        return socket.emit("error", "Cannot message this user");
      }

      const wasAnonymous = user.preferences?.anonymousMode ?? true;

      const replyData = replyToId != null
        ? await directMessageService.getReplyDataById(replyToId)
        : null;

      if (replyToId != null) {
        if (!replyData) return socket.emit("error", "Reply target does not exist");
        if (replyData.conversationId !== conversationId)
          return socket.emit("error", "Cannot reply to a message in a different conversation");
        if (replyData.deleted) return socket.emit("error", "Cannot reply to a deleted message");
      }

      const msgTempId = tempId ?? Date.now();
      const messageToSend = {
        conversationId,
        content,
        imageUrl: imageUrl ?? null,
        senderDisplayId: wasAnonymous ? "Anonymous" : user.displayId,
        timestamp: new Date().toISOString(),
        messageId: msgTempId,
        id: msgTempId,
        senderId: user.id,
        replyToId: replyToId ?? null,
        replyTo: replyData
          ? {
              id: replyData.id,
              content: replyData.deleted ? "Message Has Been Deleted" : replyData.content,
              imageUrl: replyData.deleted ? null : replyData.imageUrl,
              senderDisplayId: replyData.wasAnonymous
                ? "Anonymous"
                : replyData.sender.displayId,
            }
          : null,
      };

      io.to(`dm:${conversationId}`).emit("receiveDM", messageToSend);

      io.to(`user:${otherUserId}`).emit("receiveDM", messageToSend);

      try {
        const message = await directMessageService.createDirectMessage(
          conversationId,
          user.id,
          content,
          imageUrl,
          replyToId ?? undefined,
          wasAnonymous,
        );

        io.to(`dm:${conversationId}`).emit("dmMessageIdAssigned", {
          tempId: msgTempId,
          realId: message.id,
        });
        io.to(`user:${otherUserId}`).emit("dmMessageIdAssigned", {
          tempId: msgTempId,
          realId: message.id,
        });

        const recipientOnline = !!userSocketMap[otherUserId];
        const senderDisplay = wasAnonymous ? "Anonymous" : user.displayId;
        const bodyPreview = content
          ? content.length > 80 ? content.slice(0, 80) + "..." : content
          : "Sent you a photo";

        getNotificationPreferencesDao(otherUserId).then((prefs) => {
          if (!prefs.notifDMs) return;
          if (!recipientOnline) {
            sendPushToUser({
              userId: otherUserId,
              type: "NEW_DM" as any,
              title: senderDisplay,
              body: bodyPreview,
              data: { screen: "DM", conversationId },
            }).catch(() => {});
          }
          createNotification({
            userId: otherUserId,
            type: "NEW_DM",
            title: senderDisplay,
            body: bodyPreview,
            data: { screen: "DM", conversationId },
          }).catch(() => {});
        }).catch(() => {});
      } catch {
        io.to(`user:${user.id}`).emit("dmMessageFailed", { tempId: msgTempId });
      }
    } catch (error: any) {
      socket.emit("error", error.message || "An unexpected error has occurred");
    }
  });

  socket.on("deleteDM", async ({ conversationId, messageId }) => {
    try {
      if (!conversationId || !messageId) return;

      const conversation = await getConversationById(conversationId);
      if (!conversation) return;

      const isParticipant =
        conversation.participantAId === user.id ||
        conversation.participantBId === user.id;
      if (!isParticipant) return;

      await directMessageService.softDeleteMessage(messageId, user.id);

      io.to(`dm:${conversationId}`).emit("dmMessageDeleted", { conversationId, messageId });

      const otherUserId =
        conversation.participantAId === user.id
          ? conversation.participantBId
          : conversation.participantAId;
      io.to(`user:${otherUserId}`).emit("dmMessageDeleted", { conversationId, messageId });
    } catch {
      // silent
    }
  });

  socket.on("editDM", async ({ conversationId, messageId, content }) => {
    try {
      if (!conversationId || !messageId) return;
      if (!content || typeof content !== "string" || content.length > 2000) {
        return socket.emit("error", "Invalid message content");
      }

      const conversation = await getConversationById(conversationId);
      if (!conversation) return;

      const isParticipant =
        conversation.participantAId === user.id ||
        conversation.participantBId === user.id;
      if (!isParticipant) return;

      await directMessageService.editMessage(messageId, user.id, content);

      const otherUserId =
        conversation.participantAId === user.id
          ? conversation.participantBId
          : conversation.participantAId;

      const editPayload = {
        conversationId,
        messageId,
        content,
        editedAt: new Date().toISOString(),
      };

      io.to(`dm:${conversationId}`).emit("dmMessageEdited", editPayload);
      io.to(`user:${otherUserId}`).emit("dmMessageEdited", editPayload);
    } catch (error: any) {
      socket.emit("error", error.message || "Failed to edit message");
    }
  });

  socket.on("markDMRead", async ({ conversationId, lastMessageId }) => {
    try {
      if (!conversationId || !lastMessageId) return;

      const conversation = await getConversationById(conversationId);
      if (!conversation) return;

      const isParticipant =
        conversation.participantAId === user.id ||
        conversation.participantBId === user.id;
      if (!isParticipant) return;

      await markConversationRead(conversationId, user.id, lastMessageId);
    } catch {
      // silent — read receipts are best-effort
    }
  });

  socket.on("typingDM", ({ conversationId, isTyping }) => {
    const payload = {
      conversationId,
      isTyping,
      senderId: user.id,
      senderDisplayId: user.preferences?.anonymousMode ? "Anonymous" : user.displayId,
    };

    io.to(`dm:${conversationId}`).emit("dmTyping", payload);

    getConversationById(conversationId).then((conversation) => {
      if (!conversation) return;
      const otherUserId =
        conversation.participantAId === user.id
          ? conversation.participantBId
          : conversation.participantAId;
      io.to(`user:${otherUserId}`).emit("dmTyping", payload);
    }).catch(() => {});
  });
}
