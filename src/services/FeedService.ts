import { getDistance } from "geolib";
import { getUserLocation } from "../utils/redisUserLocation";
import { LocationDao } from "../dao/LocationDao";
import { PostService } from "./PostService";
import { prisma } from "../utils/prisma";
import redis from "../utils/setupRedis";

const locationDao = new LocationDao();
const postService = new PostService();

const DEFAULT_FEED_RADIUS_M = 3219; // 2 miles

// Cache the full location list to avoid hitting Postgres on every feed request.
// Locations are created/deleted infrequently, so a 2-minute TTL is safe.
const LOCATIONS_CACHE_KEY = "cache:all_locations";
const LOCATIONS_CACHE_TTL = 120; // seconds

export type InRangeLocation = {
  id: number;
  name: string;
};

export type FeedResult = {
  posts: Awaited<ReturnType<PostService["getFeedPosts"]>>;
  inRangeLocations: InRangeLocation[];
};

export class FeedService {
  async getFeedForUser(userId: number): Promise<FeedResult> {
    // ── 1–3. Fetch user position, preferences, and locations in parallel ───
    const [userPos, prefs, allLocations] = await Promise.all([
      getUserLocation(String(userId)),
      prisma.user_Settings.findUnique({ where: { userId } }),
      redis.get(LOCATIONS_CACHE_KEY).then(async (cached) => {
        if (cached) return JSON.parse(cached);
        const locations = await locationDao.getAllLocations();
        await redis.setex(LOCATIONS_CACHE_KEY, LOCATIONS_CACHE_TTL, JSON.stringify(locations));
        return locations;
      }),
    ]);

    if (!userPos) {
      throw new Error("User location not found — make sure location tracking is active");
    }

    const feedRadius = prefs?.feedRadius ?? DEFAULT_FEED_RADIUS_M;

    // ── 4. Filter: location centre must be within user's feed radius ─────────
    // A location qualifies if its centre is within `feedRadius` metres of the
    // user — regardless of whether the user is physically inside the location's
    // own boundary (loc.size). This lets users discover nearby hotspots.
    const inRange: InRangeLocation[] = [];
    for (const loc of allLocations) {
      if (loc.latitude == null || loc.longitude == null) continue;

      const distMetres = getDistance(
        { latitude: userPos.latitude, longitude: userPos.longitude },
        { latitude: Number(loc.latitude), longitude: Number(loc.longitude) }
      );

      if (distMetres <= feedRadius) {
        inRange.push({ id: loc.id, name: loc.name });
      }
    }

    // ── 5. Posts + result ───────────────────────────────────────────────────
    const locationIds = inRange.map((l) => l.id);
    const posts = await postService.getFeedPosts(locationIds, userId);

    return { posts, inRangeLocations: inRange };
  }
}