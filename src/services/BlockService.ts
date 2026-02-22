import {
  blockUserDao,
  unblockUserDao,
  isBlockedDao,
  getBlockedUserIdsDao,
  getBlockerUserIdsDao,
  getAllBlockRelatedUserIdsDao,
  getBlockListDao,
} from "../dao/BlockDao";

export class BlockService {
  async blockUser(blockerId: number, blockedId: number) {
    if (blockerId === blockedId) {
      throw new Error("You cannot block yourself");
    }
    const alreadyBlocked = await isBlockedDao(blockerId, blockedId);
    if (alreadyBlocked) {
      throw new Error("User is already blocked");
    }
    return blockUserDao(blockerId, blockedId);
  }

  async unblockUser(blockerId: number, blockedId: number) {
    const isBlocked = await isBlockedDao(blockerId, blockedId);
    if (!isBlocked) {
      throw new Error("User is not blocked");
    }
    return unblockUserDao(blockerId, blockedId);
  }

  async isBlocked(blockerId: number, blockedId: number) {
    return isBlockedDao(blockerId, blockedId);
  }

  async getBlockedUserIds(userId: number) {
    return getBlockedUserIdsDao(userId);
  }

  async getBlockerUserIds(userId: number) {
    return getBlockerUserIdsDao(userId);
  }

  /** All user IDs that should be invisible to this user (both directions) */
  async getAllBlockRelatedUserIds(userId: number) {
    return getAllBlockRelatedUserIdsDao(userId);
  }

  async getBlockList(userId: number) {
    return getBlockListDao(userId);
  }
}