import { Server, Socket } from "socket.io";
import { getNearbyUsers, getNearbyUsersCount, saveUserLocation } from "../utils/redisUserLocation";
import { UserWithPreferences } from "../models/userTypes";

export function setupProximitySocket(io: Server, socket: Socket, user: UserWithPreferences){
socket.on("updateLocation", async ({ latitude, longitude }) =>{
    try {
        await saveUserLocation(user.id, { latitude, longitude },user.preferences ?? { broadcastRadius: 2, recieveRadius: 2 });

        return getNearbyUsersCount(user.id, user.preferences?.broadcastRadius ?? 2 );

    } catch (error: any) {
      socket.emit("error", "An unexpected error has occured");
    }
  });
}