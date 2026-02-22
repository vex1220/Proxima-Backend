import { getDistance } from "geolib";
import { getUserLocation } from "../utils/redisUserLocation";
import { LocationDao } from "../dao/LocationDao";
import { PostService } from "./PostService";

const locationDao = new LocationDao();
const postService = new PostService();

export type InRangeLocation = {
  id: number;
  name: string;
};

export type FeedResult = {
  posts: Awaited<ReturnType<PostService["getFeedPosts"]>>;
  inRangeLocations: InRangeLocation[];
};

export class FeedService {
  /**
   * Returns feed posts within the user's current position.
   * Throws if the user's location is not known (i.e. not yet emitted to Redis).
   */
  async getFeedForUser(userId: number): Promise<FeedResult> {
    // ── 1. Resolve user's current position ─────────────────────────────────
    const userPos = await getUserLocation(String(userId));
    if (!userPos) {
      throw new Error("User location not found — make sure location tracking is active");
    }

    // ── 2. Load all active locations ────────────────────────────────────────
    const allLocations = await locationDao.getAllLocations();

    // ── 3. Filter to those whose radius contains the user ──────────────────
    // A location qualifies when:
    //   • it has valid geo coords + a non-zero size
    //   • the great-circle distance from user → location centre ≤ location.size
    const inRange: InRangeLocation[] = [];
    for (const loc of allLocations) {
      if (
        loc.latitude == null ||
        loc.longitude == null ||
        loc.size == null ||
        loc.size <= 0
      ) {
        continue;
      }

      const distMetres = getDistance(
        { latitude: userPos.latitude,  longitude: userPos.longitude },
        { latitude: Number(loc.latitude), longitude: Number(loc.longitude) }
      );

      if (distMetres <= loc.size) {
        inRange.push({ id: loc.id, name: loc.name });
      }
    }

    // ── 4. Fetch posts for all in-range locations ───────────────────────────
    const locationIds = inRange.map((l) => l.id);
    const posts = await postService.getFeedPosts(locationIds, userId);

    // ── 5. Return posts + in-range location list ────────────────────────────
    return { posts, inRangeLocations: inRange };
  }
}