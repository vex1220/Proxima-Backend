import { Router } from "express";
import {
  authenticateToken,
  authenticateAdmin,
} from "../middleware/authMiddleware";
import { createLocation, listLocations, locationDetails, getLocationsInRange } from "../controllers/locationController"
import { LocationType } from "@prisma/client";

const router = Router();

router.use(authenticateToken);

router.post("/",authenticateAdmin,createLocation);

router.get("/",listLocations);

// Must come before /:locationId to avoid being swallowed by the param route
router.get("/in-range", getLocationsInRange);

router.get("/types",(req,res) =>{
  return res.json({ types: Object.values(LocationType)});
});

router.get("/:locationId",locationDetails);

export default router;