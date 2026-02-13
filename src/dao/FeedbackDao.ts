import prisma from "../utils/prisma";
import { FeedbackMessage, FeedbackCategory } from "@prisma/client";

export class FeedbackDao {
  createFeedback(
    userId: number,
    category: FeedbackCategory,
    rating: number | null,
    comment: string | null
  ): Promise<FeedbackMessage> {
    return prisma.feedbackMessage.create({
      data: { userId, category, rating, comment },
    });
  }

  getFeedbackByUser(userId: number): Promise<FeedbackMessage[]> {
    return prisma.feedbackMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}