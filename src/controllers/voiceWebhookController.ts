import { Request, Response } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { addVoiceParticipant, removeVoiceParticipant, clearVoiceRoom, getVoiceParticipants } from "../services/voiceService";
import { getCachedBlockRelatedUserIds } from "../dao/BlockDao";
import { getIo } from "../websocket/ioInstance";
import logger from "../utils/logger";

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

function parseChatRoomId(roomName: string): number | null {
  const match = roomName.match(/^voice:chatroom:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function parseUserId(identity: string): number | null {
  const match = identity.match(/^user:(\d+)$/);
  return match ? Number(match[1]) : null;
}

export async function handleLiveKitWebhook(req: Request, res: Response) {
  try {
    const body = req.body as string;
    const authHeader = req.get("Authorization") || "";

    const event = await receiver.receive(body, authHeader);
    const io = getIo();

    if (event.event === "participant_joined" && event.participant && event.room) {
      const chatRoomId = parseChatRoomId(event.room.name);
      const userId = parseUserId(event.participant.identity);

      if (chatRoomId && userId) {
        const displayName = event.participant.name || "Anonymous";
        await addVoiceParticipant(chatRoomId, userId, displayName);

        io?.to(String(chatRoomId)).emit("voiceParticipantJoined", {
          chatRoomId,
          userId,
          displayName,
        });

        const blockedIds = await getCachedBlockRelatedUserIds(userId);
        if (blockedIds.length > 0 && io) {
          const currentParticipants = await getVoiceParticipants(chatRoomId);
          const blockedInRoom = currentParticipants.filter((p) => blockedIds.includes(p.userId));

          for (const blocked of blockedInRoom) {
            io.to(`user:${userId}`).emit("voiceBlockMute", { chatRoomId, mutedUserId: blocked.userId });
            io.to(`user:${blocked.userId}`).emit("voiceBlockMute", { chatRoomId, mutedUserId: userId });
          }
        }

        logger.info(`[Voice] User ${userId} joined voice for chatroom ${chatRoomId}`);
      }
    }

    if (event.event === "participant_left" && event.participant && event.room) {
      const chatRoomId = parseChatRoomId(event.room.name);
      const userId = parseUserId(event.participant.identity);

      if (chatRoomId && userId) {
        await removeVoiceParticipant(chatRoomId, userId);

        io?.to(String(chatRoomId)).emit("voiceParticipantLeft", {
          chatRoomId,
          userId,
        });

        logger.info(`[Voice] User ${userId} left voice for chatroom ${chatRoomId}`);
      }
    }

    if (event.event === "room_finished" && event.room) {
      const chatRoomId = parseChatRoomId(event.room.name);
      if (chatRoomId) {
        await clearVoiceRoom(chatRoomId);
        logger.info(`[Voice] Room cleared for chatroom ${chatRoomId}`);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    logger.error(`[Voice Webhook] Error: ${error.message}`);
    return res.status(400).json({ message: "Invalid webhook" });
  }
}
