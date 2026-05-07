import { Request, Response } from "express";
import { MessageReactionDao } from "../dao/MessageReactionDao";
import { ChatRoomMessageDao } from "../dao/ChatRoomMessageDao";
import { getIo } from "../websocket/ioInstance";

const ALLOWED_EMOJIS = new Set(["🔥", "😂", "😮", "😢"]);

const reactionDao = new MessageReactionDao();
const messageDao = new ChatRoomMessageDao();

export async function addReaction(req: Request, res: Response) {
  try {
    const messageId = Number(req.params.messageId);
    const { emoji } = req.body;
    const userId = req.user!.id;

    if (!messageId || isNaN(messageId)) {
      return res.status(400).json({ message: "Invalid message ID" });
    }
    if (!emoji || !ALLOWED_EMOJIS.has(emoji)) {
      return res.status(400).json({ message: "Invalid emoji" });
    }

    const message = await messageDao.getMessageById(messageId);
    if (!message || message.deleted) {
      return res.status(404).json({ message: "Message not found" });
    }

    await reactionDao.addReaction(messageId, userId, emoji);
    const reactions = await reactionDao.getReactionSummaryForMessage(messageId);

    getIo()?.to(String(message.chatRoomId)).emit("messageReactionUpdated", {
      messageId,
      reactions,
    });

    return res.json({ reactions });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}

export async function removeReaction(req: Request, res: Response) {
  try {
    const messageId = Number(req.params.messageId);
    const { emoji } = req.body;
    const userId = req.user!.id;

    if (!messageId || isNaN(messageId)) {
      return res.status(400).json({ message: "Invalid message ID" });
    }
    if (!emoji || !ALLOWED_EMOJIS.has(emoji)) {
      return res.status(400).json({ message: "Invalid emoji" });
    }

    const message = await messageDao.getMessageById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    await reactionDao.removeReaction(messageId, userId, emoji);
    const reactions = await reactionDao.getReactionSummaryForMessage(messageId);

    getIo()?.to(String(message.chatRoomId)).emit("messageReactionUpdated", {
      messageId,
      reactions,
    });

    return res.json({ reactions });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}
