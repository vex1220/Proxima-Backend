import { Router } from "express";
import { authenticateToken, authenticateAdmin } from "../middleware/authMiddleware";
import { body } from "express-validator";
import { validateRequest } from "../middleware/validateRequest";
import {
  changeUsername,
  changeUserProximityRadius,
  deleteUser,
  userDetails,
  userStatistics,
  suspendUserHandler,
  unsuspendUserHandler,
  getSuspendedUsersHandler,
} from "../controllers/userController";
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

router.get("/me", userDetails);

router.get("/stats", userStatistics);

// Block routes
router.post("/block", blockUser);
router.post("/unblock", unblockUser);
router.get("/blocks", getBlockList);

// ── Admin suspension routes (admin only) ─────────────────────────────────────
router.post(
  "/admin/suspend",
  authenticateAdmin,
  [
    body("displayId").isString().notEmpty().withMessage("displayId is required"),
    body("durationMinutes")
      .isFloat({ min: 1 })
      .withMessage("durationMinutes must be a positive number"),
  ],
  validateRequest,
  suspendUserHandler,
);

router.post(
  "/admin/unsuspend",
  authenticateAdmin,
  [body("displayId").isString().notEmpty().withMessage("displayId is required")],
  validateRequest,
  unsuspendUserHandler,
);

router.get("/admin/suspended", authenticateAdmin, getSuspendedUsersHandler);

export default router;