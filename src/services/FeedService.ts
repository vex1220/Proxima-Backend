import { getDistance } from "geolib";
import { getUserLocation } from "../utils/redisUserLocation";
import { LocationDao } from "../dao/LocationDao";
import { PostService } from "./PostService";
import { prisma } from "../utils/prisma";

const locationDao = new LocationDao();
const postService = new PostService();

const DEFAULT_FEED_RADIUS_M = 3219; // 2 miles

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
    // ── 1. User position ────────────────────────────────────────────────────
    const userPos = await getUserLocation(String(userId));
    if (!userPos) {
      throw new Error("User location not found — make sure location tracking is active");
    }

    // ── 2. User's feed radius preference ────────────────────────────────────
    const prefs = await prisma.user_Settings.findUnique({ where: { userId } });
    const feedRadius = prefs?.feedRadius ?? DEFAULT_FEED_RADIUS_M;

    // ── 3. All active locations ──────────────────────────────────────────────
    const allLocations = await locationDao.getAllLocations();

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