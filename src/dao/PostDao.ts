import {prisma} from "../utils/prisma";
import { CreatePostInput } from "../models/postTypes";

export class PostDao{
    async createPost(
        data: CreatePostInput
    ){
        return prisma.post.create({data});
    }

    async deletePost(id:number){
        return prisma.post.update({
            where: {id},
            data: {deleted : true}
        })
    }

    async getPostById(id:number){
        return prisma.post.findFirst({
            where: {id, poster: { deleted: false }},
            include: {poster: {select: {displayId: true , id: true}}},
        });
    }

    async getPostByIdWithLocation(id:number){
        return prisma.post.findFirst({
            where: {id, poster: { deleted: false }},
            include: {
                poster: {select: {displayId: true , id: true}},
                location : true
            }
        });
    }

async getPostsByLocation(locationId: number) {
  return prisma.post.findMany({
    where: {
      locationId,
      deleted: false,
      poster: { deleted: false },
    },
    select: { id: true, title: true, content: true, imageUrl: true, posterId: true, locationId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

    async getPostsByUser(userId: number) {
        return prisma.post.findMany({
            where: { posterId: userId, deleted: false },
            select: {
                id:        true,
                title:     true,
                content:   true,
                imageUrl:  true,
                createdAt: true,
                poster:    { select: { displayId: true } },
                location:  { select: { name: true } },
                _count:    { select: { comments: { where: { deleted: false } } } },
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async getPostsByLocationIds(locationIds: number[], before?: Date) {
        if (locationIds.length === 0) return { posts: [], hasMore: false };
        const PAGE_SIZE = 50;
        const rows = await prisma.post.findMany({
            where: {
                locationId: { in: locationIds },
                deleted: false,
                poster: { deleted: false },
                ...(before ? { createdAt: { lt: before } } : {}),
            },
            select: {
                id: true,
                title: true,
                content: true,
                imageUrl: true,
                posterId: true,
                locationId: true,
                createdAt: true,
                wasAnonymous: true,
                poster:   { select: { displayId: true, deleted: true } },
                location: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
            take: PAGE_SIZE + 1,
        });
        const hasMore = rows.length > PAGE_SIZE;
        return { posts: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore };
    }

    async getLocationFreePosts(
        userLat: number,
        userLng: number,
        radiusMetres: number,
        before?: Date,
    ) {
        const deltaLat = radiusMetres / 111320;
        const deltaLng = radiusMetres / (111320 * Math.cos(userLat * Math.PI / 180));

        const PAGE_SIZE = 50;
        const rows = await prisma.post.findMany({
            where: {
                locationId: null,
                deleted: false,
                poster: { deleted: false },
                latitude:  { gte: userLat - deltaLat, lte: userLat + deltaLat },
                longitude: { gte: userLng - deltaLng, lte: userLng + deltaLng },
                ...(before ? { createdAt: { lt: before } } : {}),
            },
            select: {
                id: true,
                title: true,
                content: true,
                imageUrl: true,
                posterId: true,
                locationId: true,
                latitude: true,
                longitude: true,
                createdAt: true,
                wasAnonymous: true,
                poster: { select: { displayId: true, deleted: true } },
            },
            orderBy: { createdAt: "desc" },
            take: PAGE_SIZE + 1,
        });
        const hasMore = rows.length > PAGE_SIZE;
        return { posts: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore };
    }
}