import { ChatRoom } from "@prisma/client";
import { getUserLocation, userInRangeOfLocation } from "./redisUserLocation";
import { ChatRoomMessageService } from "../services/ChatRoomMessageService";
import { getChatRoomById } from "../services/chatRoomService";
import { ChatRoomMessage } from "@prisma/client";
import { LocationDao } from "../dao/LocationDao";
import redis from "./setupRedis";

const chatRoomMessageService = new ChatRoomMessageService();
const locationDao = new LocationDao();

const CHATROOM_CACHE_TTL = 300; // 5 minutes — chatroom/location data rarely changes

function chatRoomCacheKey(roomId: number) {
  return `cache:chatroom:${roomId}`;
}

async function getCachedChatRoomWithLocation(roomId: number) {
  const key = chatRoomCacheKey(roomId);
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const chatRoom = await getChatRoomById(roomId);
  if (!chatRoom) return null;

  const location = await locationDao.getLocationById(chatRoom.locationId);
  const payload = { chatRoom, location };
  await redis.setex(key, CHATROOM_CACHE_TTL, JSON.stringify(payload));
  return payload;
}

export async function verifyChatRoomAndUserInRange(roomId: number, userId: number) {
  const cached = await getCachedChatRoomWithLocation(roomId);

  if (!cached?.chatRoom) {
    throw new Error("Chat room not found");
  }

  const { chatRoom, location } = cached;

  if (location && location.latitude != null && location.longitude != null && location.size != null) {
    const userLocation = await getUserLocation(String(userId));
    if (!userLocation) {
      throw new Error("User location not found");
    }
    const isUserInRange = await userInRangeOfLocation(
      userLocation.latitude,
      userLocation.longitude,
      location,
    );
    if (!isUserInRange) {
      throw new Error("user out of range to interact with this ChatRoom");
    }
  }
  return chatRoom;
}

export async function getAndVerifyMessage(messageId:number):Promise<ChatRoomMessage>{
    const message = await chatRoomMessageService.getMessageById(messageId);

      if (!message) {
        throw new Error("Message not found");
      }

      if (message.deleted == true) {
        throw new Error("Message is deleted");
      }

      return message;
}