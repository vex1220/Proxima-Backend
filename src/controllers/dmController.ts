import { Request, Response } from "express";
import {
  getOrCreateConversation,
  getConversationById,
  getInboxForUser,
  acceptConversation,
  deleteConversation,
} from "../dao/DirectConversationDao";
import { DirectMessageService } from "../services/DirectMessageService";
import { buildDmOriginSnapshot } from "../services/dmOriginService";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";
import { getUserByDisplayId, getUserById } from "../services/userService";
import { getIo } from "../websocket/ioInstance";
import { sendPushToUser } from "../notifications/pushService";
import { createNotification } from "../notifications/notificationDao";
import { getNotificationPreferencesDao } from "../dao/userServiceDao";

const directMessageService = new DirectMessageService();

export async function getConversations(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
    const inbox = await getInboxForUser(user.id);
    const filtered = inbox.filter((c) => !blockedUserIds.has(c.otherUser.id));

    return res.status(200).json({ conversations: filtered });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function getRequests(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const blockedUserIds = new Set(await getCachedBlockRelatedUserIds(user.id));
    const inbox = await getInboxForUser(user.id);
    const requests = inbox.filter(
      (c) =>
        c.status === "PENDING" &&
        c.initiatorId !== user.id &&
        !blockedUserIds.has(c.otherUser.id),
    );

    return res.status(200).json({ requests });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function startConversation(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { displayId, userId: targetUserId, origin } = req.body;
    if (!displayId && !targetUserId) {
      return res.status(400).json({ message: "displayId or userId is required" });
    }

    const otherUser = targetUserId
      ? await getUserById(targetUserId)
      : await getUserByDisplayId(displayId);
    if (!otherUser || otherUser.deleted) {
      return res.status(404).json({ message: "User not found" });
    }

    if (otherUser.id === user.id) {
      return res.status(400).json({ message: "Cannot start a conversation with yourself" });
    }

    const [senderBlockIds, recipientBlockIds] = await Promise.all([
      getCachedBlockRelatedUserIds(user.id),
      getCachedBlockRelatedUserIds(otherUser.id),
    ]);
    if (new Set(senderBlockIds).has(otherUser.id) || new Set(recipientBlockIds).has(user.id)) {
      return res.status(403).json({ message: "Cannot message this user" });
    }

    // Snapshot the content that sparked this DM (null when absent/invalid — the
    // conversation still starts, just without a context card). Only consulted on
    // first creation; repeat DMs to the same user keep the original spark.
    const originSnapshot = await buildDmOriginSnapshot(origin, otherUser.id);

    const conversation = await getOrCreateConversation(user.id, otherUser.id, originSnapshot);
    const full = await getConversationById(conversation.id);
    if (!full) return res.status(404).json({ message: "Conversation not found" });

    if (full.recipientWasAnonymous) {
      const recipientIsA = full.participantAId !== full.initiatorId;
      if (recipientIsA) {
        (full.participantA as any).displayId = "Anonymous";
      } else {
        (full.participantB as any).displayId = "Anonymous";
      }
    }

    return res.status(200).json({ conversation: full });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function acceptConversationRequest(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const conversationId = Number(req.params.id);
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (
      conversation.participantAId !== user.id &&
      conversation.participantBId !== user.id
    ) {
      return res.status(403).json({ message: "Not a participant" });
    }

    if (conversation.initiatorId === user.id) {
      return res.status(400).json({ message: "Cannot accept your own request" });
    }

    if (conversation.status === "ACCEPTED") {
      return res.status(400).json({ message: "Conversation already accepted" });
    }

    await acceptConversation(conversationId);

    const io = getIo();
    if (io) {
      io.to(`user:${conversation.initiatorId}`).emit("dmConversationAccepted", {
        conversationId,
      });
    }

    const acceptorDisplayId = user.displayId;
    getNotificationPreferencesDao(conversation.initiatorId).then((prefs) => {
      if (!prefs.notifDMs) return;
      createNotification({
        userId: conversation.initiatorId,
        type: "DM_ACCEPTED",
        title: acceptorDisplayId,
        body: "Accepted your message request",
        data: { screen: "DM", conversationId },
      }).catch(() => {});
      sendPushToUser({
        userId: conversation.initiatorId,
        type: "DM_ACCEPTED" as any,
        title: acceptorDisplayId,
        body: "Accepted your message request",
        data: { screen: "DM", conversationId },
      }).catch(() => {});
    }).catch(() => {});

    return res.status(200).json({ message: "Conversation accepted" });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function deleteConversationHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const conversationId = Number(req.params.id);
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (
      conversation.participantAId !== user.id &&
      conversation.participantBId !== user.id
    ) {
      return res.status(403).json({ message: "Not a participant" });
    }

    await deleteConversation(conversationId);

    return res.status(200).json({ message: "Conversation deleted" });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function getConversationMessages(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const conversationId = Number(req.params.id);
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (
      conversation.participantAId !== user.id &&
      conversation.participantBId !== user.id
    ) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const messages = await directMessageService.getMessageHistory(
      conversationId,
      user.id,
      limit,
      cursor,
    );

    return res.status(200).json({ messages });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function deleteDirectMessage(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const messageId = Number(req.params.messageId);
    if (!messageId || isNaN(messageId)) {
      return res.status(400).json({ message: "Invalid message ID" });
    }

    const message = await directMessageService.getMessageById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.senderId !== user.id && !user.isAdmin) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await directMessageService.deleteMessage(messageId);

    const io = getIo();
    if (io) {
      const conversation = await getConversationById(message.conversationId);
      if (conversation) {
        const otherUserId =
          conversation.participantAId === user.id
            ? conversation.participantBId
            : conversation.participantAId;
        io.to(`user:${otherUserId}`).emit("dmMessageDeleted", {
          messageId,
          conversationId: message.conversationId,
        });
        io.to(`user:${user.id}`).emit("dmMessageDeleted", {
          messageId,
          conversationId: message.conversationId,
        });
      }
    }

    return res.status(200).json({ message: "Message deleted" });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}
