import { Request, Response } from "express";
import { generateVoiceToken, getVoiceParticipants, getUserVoiceRoom, forceRemoveParticipant } from "../services/voiceService";
import { verifyChatRoomAndUserInRange } from "../utils/chatRoomSocketUtils";
import { getCachedSuspensionStatus } from "../utils/redisSuspension";

export async function getVoiceToken(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { chatRoomId } = req.body;
    if (!chatRoomId || typeof chatRoomId !== "number") {
      return res.status(400).json({ message: "chatRoomId is required" });
    }

    const suspension = await getCachedSuspensionStatus(user.id);
    if (suspension.suspended) {
      return res.status(403).json({ message: "Account is suspended" });
    }

    await verifyChatRoomAndUserInRange(chatRoomId, user.id, user.isAdmin);

    const existingRoom = await getUserVoiceRoom(user.id);
    if (existingRoom && existingRoom !== chatRoomId) {
      await forceRemoveParticipant(existingRoom, user.id);
    }

    const currentParticipants = await getVoiceParticipants(chatRoomId);
    if (currentParticipants.length >= 50) {
      return res.status(403).json({ message: "Voice chat is full (50 max)" });
    }

    const displayName = user.preferences?.anonymousMode ? "Anonymous" : user.displayId;

    const { token, url } = await generateVoiceToken(user.id, displayName, chatRoomId);

    return res.json({ token, url });
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404
      : error.message?.includes("range") || error.message?.includes("location") ? 403
      : 400;
    return res.status(status).json({ message: error.message });
  }
}

export async function getVoiceParticipantsHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const chatRoomId = Number(req.params.chatRoomId);
    if (isNaN(chatRoomId)) {
      return res.status(400).json({ message: "Invalid chatRoomId" });
    }

    const participants = await getVoiceParticipants(chatRoomId);
    return res.json({ participants });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}
