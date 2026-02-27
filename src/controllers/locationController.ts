import { Request, Response } from "express";
import { LocationService } from "../services/LocationService";

const locationService = new LocationService();

export async function createLocation(req: Request, res: Response) {
  try {
    const {name,latitude,longitude,size,type} = req.body;

    const result = await locationService.createLocation(name,latitude,longitude,size,type);
    const locationList = await locationService.listLocations();
    return res.status(201).json({
      message: `location: ${result.location.name} has been created`,
      createdLocationId: result.location.id,
      defaultChatRoomId: result.defaultChatRoom.id,
      locationList,
    });
} catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

export async function listLocations(req: Request, res: Response) {
  try {
    const locationList = await locationService.listLocations();

    return res.status(200).json({locationList});
  }catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

/**
 * GET /location/in-range
 * Returns every location whose own boundary (loc.size) contains the user's
 * current GPS position — i.e. locations the user can actually post in.
 * This is different from the feed radius, which is a user preference.
 */
export async function getLocationsInRange(req: Request, res: Response) {
  try {
    const user = req.user as any;

    if (user.isAdmin) {
      const allLocations = await locationService.listLocations();
      const locations = allLocations.map((loc: any) => ({ id: loc.id, name: loc.name }));
      return res.status(200).json({ locations });
    }

    const { getUserLocation } = await import("../utils/redisUserLocation");
    const { getDistance } = await import("geolib");

    const userPos = await getUserLocation(String(user.id));
    if (!userPos) {
      return res.status(200).json({ locations: [] });
    }

    const allLocations = await locationService.listLocations();

    const inRange = allLocations
      .filter((loc: any) =>
        loc.latitude != null && loc.longitude != null && loc.size != null &&
        getDistance(
          { latitude: userPos.latitude, longitude: userPos.longitude },
          { latitude: Number(loc.latitude), longitude: Number(loc.longitude) },
        ) <= loc.size
      )
      .map((loc: any) => ({ id: loc.id, name: loc.name }));

    return res.status(200).json({ locations: inRange });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}

export async function locationDetails(req: Request, res: Response) {
  try {
    const locationId = Number(req.params.locationId);

    if (!locationId || Number.isNaN(locationId)) {
      return res.status(400).json({ message: "invalid locationId" });
    }

    // Pass the authenticated user's ID so block filtering works on posts
    const viewerUserId = (req as any).user?.id;
    const payload = await locationService.getLocationDetails(locationId, viewerUserId);

    return res.status(200).json(payload);
  }catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}