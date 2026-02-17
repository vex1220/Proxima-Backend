import { Vote } from "../../models/voteTypes";

export abstract class AbstractVoteDao {
    protected abstract model: any;

    async createOrUpdateVote(vote: Vote) {
    return this.model.upsert({
      where: {
        userId_targetId: { userId:vote.userId, targetId: vote.targetId },
      },
      update: { value : vote.value },
      create: {
        userId: vote.userId,
        targetId:vote.targetId,
        value:vote.value,
      },
    });
  }

  async removeVote(userId: number, targetId: number) {
      return this.model.delete({
        where: {
          userId_targetId: { userId, targetId },
        },
      });
    }
  
    async getVote(userId: number, targetId: number) {
      return this.model.findUnique({
          where: {
              userId_targetId:{ userId, targetId},
          },
      });
    }
  
    async getVoteCount(targetId:number): Promise<number> {
      const result = await this.model.aggregate({
          where: {targetId},
          _sum: {value:true},
      });
  
      return result._sum.value ?? 0;
    }

}