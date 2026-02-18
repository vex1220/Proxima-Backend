import { Router } from "express";
import {
  authenticateToken,
  authenticateAdmin,
} from "../middleware/authMiddleware";
import { commentOnPost, createPost, postDetails, voteOnComment, voteOnPost } from "../controllers/postController";

const router = Router();

router.use(authenticateToken);

router.post("/",createPost);

router.get("/:postId",postDetails);

router.post("/vote/:postId",voteOnPost)

router.post("/:postId/comment",commentOnPost);

router.post("/vote/comment/:id",voteOnComment);

export default router;