import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { verifyLocationAndUserInRange } from "../utils/locationUtils";
import redis from "../utils/setupRedis";
import logger from "../utils/logger";

const RANKINGS_CACHE_TTL = 60;

const VALID_VOTE_TYPES = ["TOUSE", "BOUSE"] as const;
type VoteType = (typeof VALID_VOTE_TYPES)[number];

function isValidVoteType(value: unknown): value is VoteType {
  return typeof value === "string" && VALID_VOTE_TYPES.includes(value as VoteType);
}

function rankingsCacheKey(campusId: number) {
  return `cache:greek_rankings:${campusId}`;
}

async function isEligible(
  userId: number,
  userEmail: string,
  isAdmin: boolean,
  location: any,
  verifiedCampusId?: number | null,
  allowedDomains?: string[],
): Promise<boolean> {
  if (isAdmin) return true;
  if (!location.campusLocationId) return false;

  // Verified students vote on their own campus's houses regardless of location.
  if (verifiedCampusId && location.campusLocationId === verifiedCampusId) {
    return true;
  }

  if (allowedDomains && allowedDomains.length > 0) {
    const emailLower = userEmail.toLowerCase();
    if (allowedDomains.some((d) => emailLower.endsWith(`@${d.toLowerCase()}`))) return true;
  }

  const domain = await prisma.campusEmailDomain.findFirst({
    where: { campusId: location.campusLocationId },
    select: { domain: true },
  });

  if (domain && userEmail.toLowerCase().endsWith(`@${domain.domain.toLowerCase()}`)) return true;

  try {
    const inRange = await verifyLocationAndUserInRange(location, userId);
    return inRange;
  } catch {
    return false;
  }
}

export async function voteOnGreekHouse(req: Request, res: Response) {
  try {
    const user = req.user!;
    const locationId = Number(req.params.locationId);
    const voteType = req.body.voteType;

    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ message: "Invalid locationId" });
    }
    if (!isValidVoteType(voteType)) {
      return res.status(400).json({ message: "voteType must be TOUSE or BOUSE" });
    }

    const location = await prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location || location.deleted) {
      return res.status(404).json({ message: "Location not found" });
    }
    if (location.type !== "GREEK" || !location.greekCategory || !location.campusLocationId) {
      return res.status(400).json({ message: "This location is not a rateable Greek house" });
    }

    const eligible = await isEligible(user.id, user.email, !!user.isAdmin, location, user.verifiedCampusId);
    if (!eligible) {
      return res.status(403).json({ message: "You must be in range or have a matching campus email to vote" });
    }

    const oppositeType = voteType === "TOUSE" ? "BOUSE" : "TOUSE";
    const oppositeVote = await prisma.greekHouseVote.findUnique({
      where: {
        userId_campusId_category_voteType: {
          userId: user.id,
          campusId: location.campusLocationId,
          category: location.greekCategory,
          voteType: oppositeType,
        },
      },
    });

    if (oppositeVote && oppositeVote.locationId === locationId) {
      return res.status(400).json({ message: "You cannot give both Touse and Bouse to the same house" });
    }

    await prisma.greekHouseVote.upsert({
      where: {
        userId_campusId_category_voteType: {
          userId: user.id,
          campusId: location.campusLocationId,
          category: location.greekCategory,
          voteType,
        },
      },
      update: {
        locationId: location.id,
      },
      create: {
        userId: user.id,
        locationId: location.id,
        campusId: location.campusLocationId,
        category: location.greekCategory,
        voteType,
      },
    });

    await redis.del(rankingsCacheKey(location.campusLocationId));

    logger.info(`[GreekRating] User ${user.id} voted ${voteType} for location ${locationId} (${location.greekCategory})`);

    return res.status(200).json({ message: "Vote recorded" });
  } catch (error) {
    console.error("[GreekRating] Vote error:", error);
    return res.status(500).json({ message: "Failed to record vote" });
  }
}

export async function removeGreekHouseVote(req: Request, res: Response) {
  try {
    const user = req.user!;
    const locationId = Number(req.params.locationId);
    const voteType = req.body.voteType;

    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ message: "Invalid locationId" });
    }
    if (!isValidVoteType(voteType)) {
      return res.status(400).json({ message: "voteType must be TOUSE or BOUSE" });
    }

    const location = await prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location || !location.campusLocationId || !location.greekCategory) {
      return res.status(404).json({ message: "Location not found" });
    }

    const existing = await prisma.greekHouseVote.findUnique({
      where: {
        userId_campusId_category_voteType: {
          userId: user.id,
          campusId: location.campusLocationId,
          category: location.greekCategory,
          voteType,
        },
      },
    });

    if (!existing || existing.locationId !== locationId) {
      return res.status(404).json({ message: "Vote not found" });
    }

    await prisma.greekHouseVote.delete({
      where: { id: existing.id },
    });

    await redis.del(rankingsCacheKey(location.campusLocationId));

    return res.status(200).json({ message: "Vote removed" });
  } catch (error) {
    console.error("[GreekRating] Remove vote error:", error);
    return res.status(500).json({ message: "Failed to remove vote" });
  }
}

export async function getGreekRankings(req: Request, res: Response) {
  try {
    const user = req.user!;
    const campusId = Number(req.params.campusId);
    if (!campusId || isNaN(campusId)) {
      return res.status(400).json({ message: "Invalid campusId" });
    }

    const cached = await redis.get(rankingsCacheKey(campusId));
    let rankings: any;

    if (cached) {
      rankings = JSON.parse(cached);
    } else {
      const greekHouses = await prisma.location.findMany({
        where: {
          type: "GREEK",
          campusLocationId: campusId,
          deleted: false,
          greekCategory: { not: null },
        },
        select: { id: true, name: true, greekCategory: true },
      });

      if (greekHouses.length === 0) {
        return res.status(200).json({ fraternities: [], sororities: [] });
      }

      const locationIds = greekHouses.map((h) => h.id);

      const voteCounts = await prisma.greekHouseVote.groupBy({
        by: ["locationId", "voteType"],
        where: { locationId: { in: locationIds } },
        _count: { id: true },
      });

      const touseMap: Record<number, number> = {};
      const bouseMap: Record<number, number> = {};
      for (const vc of voteCounts) {
        if (vc.voteType === "TOUSE") {
          touseMap[vc.locationId] = vc._count.id;
        } else {
          bouseMap[vc.locationId] = vc._count.id;
        }
      }

      const buildList = (houses: typeof greekHouses) =>
        houses
          .map((h) => ({
            locationId: h.id,
            name: h.name,
            touseVotes: touseMap[h.id] ?? 0,
            bouseVotes: bouseMap[h.id] ?? 0,
            score: (touseMap[h.id] ?? 0) - (bouseMap[h.id] ?? 0),
          }))
          .sort((a, b) => b.score - a.score);

      const addLabels = (list: any[]) =>
        list.map((item, i) => ({
          ...item,
          rank: i + 1,
          label: list.length >= 2 ? (i === 0 ? "Touse" : i === list.length - 1 ? "Bouse" : null) : null,
        }));

      rankings = {
        fraternities: addLabels(buildList(greekHouses.filter((h) => h.greekCategory === "FRATERNITY"))),
        sororities: addLabels(buildList(greekHouses.filter((h) => h.greekCategory === "SORORITY"))),
      };

      await redis.setex(rankingsCacheKey(campusId), RANKINGS_CACHE_TTL, JSON.stringify(rankings));
    }

    const userVotes = await prisma.greekHouseVote.findMany({
      where: { userId: user.id, campusId },
      select: { locationId: true, category: true, voteType: true },
    });

    const userVoteMap: Record<string, number> = {};
    for (const v of userVotes) {
      userVoteMap[`${v.category}_${v.voteType}`] = v.locationId;
    }

    const attachUserVotes = (list: any[], category: string) =>
      list.map((item: any) => ({
        ...item,
        isMyTouseVote: userVoteMap[`${category}_TOUSE`] === item.locationId,
        isMyBouseVote: userVoteMap[`${category}_BOUSE`] === item.locationId,
      }));

    return res.status(200).json({
      fraternities: attachUserVotes(rankings.fraternities, "FRATERNITY"),
      sororities: attachUserVotes(rankings.sororities, "SORORITY"),
    });
  } catch (error) {
    console.error("[GreekRating] Rankings error:", error);
    return res.status(500).json({ message: "Failed to fetch rankings" });
  }
}

export async function getMyGreekVotes(req: Request, res: Response) {
  try {
    const user = req.user!;
    const campusId = Number(req.params.campusId);
    if (!campusId || isNaN(campusId)) {
      return res.status(400).json({ message: "Invalid campusId" });
    }

    const votes = await prisma.greekHouseVote.findMany({
      where: { userId: user.id, campusId },
      select: { locationId: true, category: true, voteType: true },
    });

    const result: Record<string, number | null> = {
      FRATERNITY_TOUSE: null,
      FRATERNITY_BOUSE: null,
      SORORITY_TOUSE: null,
      SORORITY_BOUSE: null,
    };
    for (const v of votes) {
      result[`${v.category}_${v.voteType}`] = v.locationId;
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("[GreekRating] My votes error:", error);
    return res.status(500).json({ message: "Failed to fetch votes" });
  }
}
