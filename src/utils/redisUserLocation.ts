import { ChatRoom, Location, LocationType } from "@prisma/client";
import redis from "./setupRedis";
import { getDistance } from "geolib";

const USER_LOCATIONS_KEY = "user:locations";

// Save user location using Redis GEOADD
export async function saveUserLocation(
  userId: number,
  location: { latitude: number; longitude: number },
) {
  await redis.geoadd(
    USER_LOCATIONS_KEY,
    location.longitude,
    location.latitude,
    String(userId),
  );
}

// Get user location using GEOPOS
export async function getUserLocation(userId: string) {
  const pos = await redis.geopos(USER_LOCATIONS_KEY, userId);
  if (!pos || !pos[0]) return null;
  const [longitude, latitude] = pos[0];
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

export async function getNearbyUsers(
  latitude: number,
  longitude: number,
  radius: number,
): Promise<number[]> {
  const userIds = (await redis.georadius(
    USER_LOCATIONS_KEY,
    longitude,
    latitude,
    radius,
    "m",
  )) as string[];
  return userIds.map(Number);
}

export async function userInRangeOfLocation(
  userLatitude: number,
  userLongitude: number,
  location: Location,
) {
  if (
    location.latitude == null ||
    location.longitude == null ||
    location.size == null ||
    userLatitude == null ||
    userLongitude == null
  ) {
    throw new Error(
      "ChatRoom or user location is missing latitude, longitude, or size",
    );
  }

  const distance = getDistance(
    { latitude: Number(userLatitude), longitude: Number(userLongitude) },
    {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    },
  );
  return distance <= location.size;
}

export async function filterMutuallyNearbyUsers(
  userId: number,
  currentUserLocation: { latitude: number; longitude: number },
  nearbyUserIds: number[],
  userSocketMap: {
    [userId: number]: { socketId: string; proximityRadius: number };
  },
) {
  const mutuallyNearby: number[] = [];
  for (const id of nearbyUserIds) {
    const nearbyUserLocation = await getUserLocation(String(id));
    const nearbyUserRadius = userSocketMap[id]?.proximityRadius ?? 1600;
    if (!nearbyUserLocation) continue;

    const distance = getDistance(
      {
        latitude: nearbyUserLocation.latitude,
        longitude: nearbyUserLocation.longitude,
      },
      {
        latitude: currentUserLocation.latitude,
        longitude: currentUserLocation.longitude,
      },
    );

    if (distance <= nearbyUserRadius) {
      mutuallyNearby.push(id);
    }
  }
  // Map user IDs to socket IDs and filter out any undefined
  return mutuallyNearby
    .map((id) => userSocketMap[id]?.socketId)
    .filter(Boolean);
}

export async function removeUserLocation(userId: number) {
  try {
    await redis.zrem(USER_LOCATIONS_KEY, String(userId));
  } catch (error) {
    console.error("Error removing user location:", error);
  }
}

export async function getNearbyUsersCount(
  userId: number,
  radius: number,
  userSocketMap: {
    [userId: number]: { socketId: string; proximityRadius: number };
  },
) {
  const location = await getUserLocation(String(userId));
  if (!location) return 0;

  // Step 1: find everyone within MY radius (one-directional)
  const nearbyUserIds = await getNearbyUsers(
    location.latitude,
    location.longitude,
    radius,
  );

  // Step 2: keep only users who also have ME within THEIR radius (mutual)
  let mutualCount = 0;
  for (const id of nearbyUserIds) {
    if (id === userId) continue;

    const otherLocation = await getUserLocation(String(id));
    if (!otherLocation) continue;

    const otherRadius = userSocketMap[id]?.proximityRadius ?? 1600;

    const distance = getDistance(
      { latitude: location.latitude, longitude: location.longitude },
      { latitude: otherLocation.latitude, longitude: otherLocation.longitude },
    );

    if (distance <= otherRadius) {
      mutualCount++;
    }
  }

  return mutualCount;
}

//left off here