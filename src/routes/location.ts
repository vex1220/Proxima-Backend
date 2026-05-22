import { Router } from "express";
import multer from "multer";
import {
  authenticateToken,
  authenticateAdmin,
} from "../middleware/authMiddleware";
import {
  createLocation,
  listLocations,
  locationDetails,
  getLocationsInRange,
  getActiveCounts,
  deleteLocation,
  updateLocationImage,
} from "../controllers/locationController";
import { LocationType } from "@prisma/client";

const router = Router();

// Multer (memory storage — sharp processes the buffer before S3 upload).
// Mirrors the existing /upload/image route's setup but kept local so the
// 5 MB cap and image-only filter are explicit at the call site.
const locationImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

router.use(authenticateToken);

router.post("/",authenticateAdmin,createLocation);

router.get("/",listLocations);

router.get("/active-counts", getActiveCounts);

// Must come before /:locationId to avoid being swallowed by the param route
router.get("/in-range", getLocationsInRange);

router.get("/types",(req,res) =>{
  return res.json({ types: Object.values(LocationType)});
});

router.get("/:locationId",locationDetails);
router.post("/delete", authenticateAdmin, deleteLocation);

router.patch(
  "/:locationId/image",
  authenticateAdmin,
  locationImageUpload.single("image"),
  updateLocationImage,
);

export default router;