import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { body } from "express-validator";
import { validateRequest } from "../middleware/validateRequest";
import { changeUsername, changeUserProximityRadius, changeUserFeedRadius, deleteUser, userDetails, userStatistics } from "../controllers/userController";
import { blockUser, unblockUser, getBlockList } from "../controllers/blockController";

const router = Router();

router.use(authenticateToken);

router.post("/delete", deleteUser);

router.post(
  "/changeUsername",
  [
    body("newUserName")
      .not()
      .isEmail()
      .withMessage("username cannot be an email address dummy"),
  ],
  validateRequest,
  changeUsername,
);

router.post("/changeProximityRadius", changeUserProximityRadius);
router.post("/changeFeedRadius", changeUserFeedRadius);

router.get("/me", userDetails);

router.get("/stats", userStatistics);

// Block routes
router.post("/block", blockUser);
router.post("/unblock", unblockUser);
router.get("/blocks", getBlockList);

export default router;