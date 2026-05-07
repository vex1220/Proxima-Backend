import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  getConversations,
  getRequests,
  startConversation,
  acceptConversationRequest,
  deleteConversationHandler,
  getConversationMessages,
  deleteDirectMessage,
} from "../controllers/dmController";

const router = Router();

router.use(authenticateToken);

router.get("/conversations", getConversations);
router.get("/requests", getRequests);
router.post("/conversations", startConversation);
router.post("/conversations/:id/accept", acceptConversationRequest);
router.delete("/conversations/:id", deleteConversationHandler);
router.get("/conversations/:id/messages", getConversationMessages);
router.delete("/messages/:messageId", deleteDirectMessage);

export default router;
