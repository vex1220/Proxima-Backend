import { prisma } from "../utils/prisma";

export type ReactionSummary = {
  emoji: string;
  count: number;
  userIds: number[];
};

export class MessageReactionDao {
  async addReaction(messageId: number, userId: number, emoji: string): Promise<void> {
    await prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, userId, emoji },
      update: {},
    });
  }

  async removeReaction(messageId: number, userId: number, emoji: string): Promise<void> {
    await prisma.messageReaction.deleteMany({
      where: { messageId, userId, emoji },
    });
  }

  async getReactionSummary(messageIds: number[]): Promise<Record<number, ReactionSummary[]>> {
    if (messageIds.length === 0) return {};

    const rows = await prisma.messageReaction.findMany({
      where: { messageId: { in: messageIds } },
      select: { messageId: true, userId: true, emoji: true },
    });

    const grouped: Record<number, Record<string, { count: number; userIds: number[] }>> = {};

    for (const row of rows) {
      const emoji = row.emoji;
      if (!grouped[row.messageId]) grouped[row.messageId] = {};
      if (!grouped[row.messageId][emoji]) grouped[row.messageId][emoji] = { count: 0, userIds: [] };
      grouped[row.messageId][emoji].count += 1;
      grouped[row.messageId][emoji].userIds.push(row.userId);
    }

    const result: Record<number, ReactionSummary[]> = {};
    for (const [msgId, emojiMap] of Object.entries(grouped)) {
      result[Number(msgId)] = Object.entries(emojiMap).map(([emoji, data]) => ({
        emoji,
        count: data.count,
        userIds: data.userIds,
      }));
    }

    return result;
  }

  async getReactionSummaryForMessage(messageId: number): Promise<ReactionSummary[]> {
    const map = await this.getReactionSummary([messageId]);
    return map[messageId] ?? [];
  }
}
