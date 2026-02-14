import { LocationType } from "@prisma/client";
import prisma from "../utils/prisma";

export class LocationDao {
  async createLocation(
    name: string,
    latitude: number | null = null,
    longitude: number | null = null,
    size: number = 0,
    type: LocationType,
  ) {
    return prisma.location.create({
      data: { name, latitude, longitude, size, type },
    });
  }

  async deleteLocation(id: number) {
    return prisma.location.update({ where: { id }, data: { deleted: true } });
  }

  async getLocationById(id: number) {
    return prisma.location.findUnique({ where: { id } });
  }

  async getLocationByName(name: string) {
    return prisma.location.findFirst({ where: { name: name, deleted: false } });
  }

  async getLocationByNameExcludingId(name:string,excludeId:number){
    return prisma.location.findFirst({
    where: { name, deleted: false, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  });
  }

  async updateLocation(
    id: number,
    updates: {
      name?: string;
      latitude?: number | null;
      longitude?: number | null;
      size?: number;
      type?: LocationType;
    },
  ) {
    return prisma.location.update({ where: { id }, data: updates });
  }

  async getAllLocations() {
    return prisma.location.findMany({
      where: { deleted: false },
    });
  }
}
