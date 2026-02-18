import { prisma } from "./prisma";
import { VoteModel, Vote } from "../models/voteTypes";


export function getVoteModel(modelType: VoteModel) {
  return prisma[modelType];
}

export function constructVote(value: number, userId: number, targetId: number): Vote {
  return {
    value,
    userId,
    targetId
  };
}

export function validateNotOwnPost(userId:number, id:number) {
  if (userId == id) {
    throw new Error("user cannot vote on their own post");
  }
}