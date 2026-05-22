import { Request, Response } from "express";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { LocationService } from "../services/LocationService";
import redis from "../utils/setupRedis";
import { prisma } from "../utils/prisma";

const LOCATIONS_CACHE_KEY = "cache:all_locations";

const locationService = new LocationService();

// Sized for the map circle (40 px base, retina). Square crop, lightweight webp.
const THUMBNAIL_SIZE = 192;
// Full hero image cap — keeps detail-view downloads small without nuking quality.
const FULL_MAX_WIDTH = 1024;

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function createLocation(req: Request, res: Response) {
  try {
    const {name,latitude,longitude,size,type,greekCategory,campusLocationId} = req.body;

    const result = await locationService.createLocation(name,latitude,longitude,size,type,greekCategory,campusLocationId);
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
/**
 * GET /location/active-counts
 * Returns a map of locationId → number of users currently within each
 * location's radius. Uses the Redis geo-set (which only contains connected
 * users, since removeUserLocation is called on disconnect) and the cached
 * location list to avoid any DB hit on the hot path.
 */
export async function getActiveCounts(req: Request, res: Response) {
  try {
    // Reuse the same 2-minute cached location list that FeedService populates
    const cachedRaw = await redis.get(LOCATIONS_CACHE_KEY);
    let allLocations: any[];
    if (cachedRaw) {
      allLocations = JSON.parse(cachedRaw);
    } else {
      // Cache miss — fall back to DB and warm the cache
      const { LocationDao } = await import("../dao/LocationDao");
      const dao = new LocationDao();
      allLocations = await dao.getAllLocations();
      await redis.setex(LOCATIONS_CACHE_KEY, 120, JSON.stringify(allLocations));
    }

    // Only locations that have coordinates are mappable
    const mappable = allLocations.filter(
      (loc: any) =>
        loc.latitude != null && loc.longitude != null && loc.size != null,
    );

    // Batch all GEORADIUS queries into a single pipeline round-trip
    const pipeline = redis.pipeline();
    for (const loc of mappable) {
      pipeline.georadius(
        "user:locations",
        Number(loc.longitude),
        Number(loc.latitude),
        Number(loc.size),
        "m",
      );
    }
    const results = await pipeline.exec();

    const counts: Record<number, number> = {};
    for (let i = 0; i < mappable.length; i++) {
      const [err, members] = results![i] as [Error | null, string[]];
      counts[mappable[i].id] = err || !members ? 0 : members.length;
    }

    return res.status(200).json({ counts });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}

export async function deleteLocation(req: Request, res: Response) {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: "Location id is required" });

    await prisma.location.delete({ where: { id } });

    return res.status(200).json({ message: "Location deleted" });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
}

/**
 * PATCH /location/:id/image
 *
 * Admin-only. Receives a multipart upload, generates two S3 objects (a
 * hero-size jpeg and a square thumbnail for the map marker), stores both
 * URLs on the Location row, and invalidates the cached location list so
 * other clients pick up the change on their next refetch.
 *
 * The thumbnail is centre-cropped to a square — admins should upload roughly
 * square photos but the crop is forgiving for off-square sources.
 */
export async function updateLocationImage(req: Request, res: Response) {
  try {
    const locationId = Number(req.params.locationId);
    if (!locationId || Number.isNaN(locationId)) {
      return res.status(400).json({ message: "invalid locationId" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image provided" });
    }

    const exists = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, deleted: true },
    });
    if (!exists || exists.deleted) {
      return res.status(404).json({ message: "Location not found" });
    }

    // Timestamp suffix forces a fresh URL on every change, so expo-image's
    // disk cache and any CDN edge cache transparently miss and reload.
    const ts = Date.now();

    // Process both sizes in parallel.
    const [fullBuf, thumbBuf] = await Promise.all([
      sharp(req.file.buffer)
        .rotate() // honour EXIF orientation
        .resize(FULL_MAX_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer(),
      sharp(req.file.buffer)
        .rotate()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer(),
    ]);

    const fullKey = `locations/${locationId}-${ts}.jpg`;
    const thumbKey = `locations/${locationId}-${ts}-thumb.webp`;

    await Promise.all([
      s3.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: fullKey,
        Body: fullBuf,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })),
      s3.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: thumbKey,
        Body: thumbBuf,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })),
    ]);

    const base = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    const imageUrl = `${base}/${fullKey}`;
    const thumbnailUrl = `${base}/${thumbKey}`;

    const updated = await prisma.location.update({
      where: { id: locationId },
      data: { imageUrl, thumbnailUrl },
      select: { id: true, imageUrl: true, thumbnailUrl: true },
    });

    // Bust the location-list cache so other clients pick up the new image on
    // their next list fetch (within ~2 minutes by TTL otherwise).
    await redis.del(LOCATIONS_CACHE_KEY).catch(() => {});

    return res.status(200).json(updated);
  } catch (error: any) {
    console.error("[updateLocationImage] Error:", error);
    return res.status(500).json({ message: error.message ?? "Failed to update image" });
  }
}