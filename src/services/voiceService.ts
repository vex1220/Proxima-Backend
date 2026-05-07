import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import redis from "../utils/setupRedis";

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

function voiceRoomName(chatRoomId: number): string {
  return `voice:chatroom:${chatRoomId}`;
}

function voiceParticipantsKey(chatRoomId: number): string {
  return `voice:participants:${chatRoomId}`;
}

function voiceUserKey(userId: number): string {
  return `voice:user:${userId}`;
}

export async function generateVoiceToken(
  userId: number,
  displayName: string,
  chatRoomId: number,
): Promise<{ token: string; url: string }> {
  const roomName = voiceRoomName(chatRoomId);

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `user:${userId}`,
    name: displayName,
    ttl: "4h",
  });

  at.addGrant({
    roomJoin: true,
    roomCreate: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });

  const token = await at.toJwt();

  await redis.set(voiceUserKey(userId), String(chatRoomId));

  return { token, url: LIVEKIT_URL };
}

export async function getVoiceParticipants(chatRoomId: number): Promise<{ userId: number; displayName: string }[]> {
  const members = await redis.smembers(voiceParticipantsKey(chatRoomId));
  return members.map((m) => {
    const parsed = JSON.parse(m);
    return { userId: parsed.userId, displayName: parsed.displayName };
  });
}

export async function addVoiceParticipant(chatRoomId: number, userId: number, displayName: string): Promise<void> {
  await redis.sadd(voiceParticipantsKey(chatRoomId), JSON.stringify({ userId, displayName }));
  await redis.set(voiceUserKey(userId), String(chatRoomId));
}

export async function removeVoiceParticipant(chatRoomId: number, userId: number): Promise<void> {
  const members = await redis.smembers(voiceParticipantsKey(chatRoomId));
  for (const m of members) {
    const parsed = JSON.parse(m);
    if (parsed.userId === userId) {
      await redis.srem(voiceParticipantsKey(chatRoomId), m);
      break;
    }
  }
  await redis.del(voiceUserKey(userId));
}

export async function clearVoiceRoom(chatRoomId: number): Promise<void> {
  const members = await redis.smembers(voiceParticipantsKey(chatRoomId));
  for (const m of members) {
    const parsed = JSON.parse(m);
    await redis.del(voiceUserKey(parsed.userId));
  }
  await redis.del(voiceParticipantsKey(chatRoomId));
}

export async function getUserVoiceRoom(userId: number): Promise<number | null> {
  const roomId = await redis.get(voiceUserKey(userId));
  return roomId ? Number(roomId) : null;
}

export async function forceRemoveParticipant(chatRoomId: number, userId: number): Promise<void> {
  const roomName = voiceRoomName(chatRoomId);
  try {
    await roomService.removeParticipant(roomName, `user:${userId}`);
  } catch {
    // Participant may already have left
  }
  await removeVoiceParticipant(chatRoomId, userId);
}
