import { FeedService } from "../services/FeedService";
import { withAuth } from "../utils/handler";

const feedService = new FeedService();

export const getFeed = withAuth(async (req, res) => {
  try {
    const user = req.user;
    const result = await feedService.getFeedForUser(user.id);
    return res.status(200).json(result);
  } catch (error: any) {
    // Distinguish "no location" from real server errors
    if (
      error.message?.includes("User location not found") ||
      error.message?.includes("location not found")
    ) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
});