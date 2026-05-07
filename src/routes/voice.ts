import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateToken } from "../middleware/authMiddleware";
import { getVoiceToken, getVoiceParticipantsHandler } from "../controllers/voiceController";
import { handleLiveKitWebhook } from "../controllers/voiceWebhookController";
import express from "express";

const router = Router();

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { message: "Too many voice token requests, please try again later." },
});

const participantsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { message: "Too many requests, please try again later." },
});

router.post("/webhook", express.text({ type: "*/*" }), handleLiveKitWebhook);

router.use(authenticateToken);
router.post("/token", tokenLimiter, getVoiceToken);
router.get("/participants/:chatRoomId", participantsLimiter, getVoiceParticipantsHandler);

export default router;
