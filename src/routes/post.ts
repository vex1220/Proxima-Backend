import { Router } from "express";
import {
  authenticateToken,
  authenticateAdmin,
} from "../middleware/authMiddleware";
import { requireNotSuspended } from "../middleware/suspendMiddleware";
import {
  commentOnPost,
  createPost,
  postDetails,
  voteOnComment,
  voteOnPost,
  deletePostVote,
  deleteCommentVote,
  deletePost,
} from "../controllers/postController";

const router = Router();

router.use(authenticateToken);

// Write actions — blocked for suspended users
router.post("/", requireNotSuspended, createPost);
router.post("/:postId/comment", requireNotSuspended, commentOnPost);

router.get("/:postId", postDetails);

router.post("/vote/comment/:id", voteOnComment);
router.delete("/vote/comment/:id", deleteCommentVote);

router.post("/vote/:postId", voteOnPost);
router.delete("/vote/:postId", deletePostVote);

// Must come after /vote routes to avoid catching them
router.delete("/:postId", requireNotSuspended, deletePost);

export default router;