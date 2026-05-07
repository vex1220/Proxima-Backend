import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  voteOnGreekHouse,
  removeGreekHouseVote,
  getGreekRankings,
  getMyGreekVotes,
} from "../controllers/greekRatingController";

const router = Router();

router.use(authenticateToken);
router.post("/vote/:locationId", voteOnGreekHouse);
router.delete("/vote/:locationId", removeGreekHouseVote);
router.get("/rankings/:campusId", getGreekRankings);
router.get("/my-votes/:campusId", getMyGreekVotes);

export default router;
