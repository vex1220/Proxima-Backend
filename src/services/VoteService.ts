import { Vote } from "../models/voteTypes";
import { VoteDao } from "../dao/VoteDao";
import { VoteModel } from "../models/voteTypes";
import { getVoteModel } from "../utils/voteUtils";

export class VoteService {
  private dao: VoteDao;

  constructor(modelType: VoteModel) {
    const model = getVoteModel(modelType);
    this.dao = new VoteDao(model);
  }

  async voteOnMessage(vote: Vote) {
    if (vote.value != 1 && vote.value != -1) {
      throw new Error("values not 1 or -1 not supported");
    }

    if ( vote.userId == vote.targetId) {
      throw new Error("user cannot vote on this message");
    }

    return await this.dao.createOrUpdateVote(vote);
  }

  async removeVote(vote:Vote) {
    return await this.dao.removeVote(vote);
  }

  async getVote(vote:Vote) {
    return await this.dao.getVote(vote);
  }

  async getVoteCount(targetId: number) {
    return await this.dao.getVoteCount(targetId);
  }
}
