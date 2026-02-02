import redis from "./setupRedis";

const USER_LOCATIONS_KEY = "user:locations";

// Save user location using Redis GEOADD
export async function saveUserLocation(
  userId: number,
  location: { latitude: number; longitude: number },
  userPreferences?: { broadcastRadius?: number, recieveRadius?: number }
) {
  await redis.geoadd(
    USER_LOCATIONS_KEY,
    location.longitude,
    location.latitude,
    String(userId),
    userPreferences?.broadcastRadius ?? 2,
    userPreferences?.recieveRadius ?? 2,

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
) {
  // Returns array of userIds
  return await redis.georadius(
    USER_LOCATIONS_KEY,
    longitude,
    latitude,
    radius,
    "m",
  );
}

export async function getNearbyUsersCount(userId: number, radius: number) {
  const location = await getUserLocation(String(userId));
  if (!location) return 0;

  return (await getNearbyUsers(location.latitude, location.longitude, radius))
    .length;
}

//left off here
