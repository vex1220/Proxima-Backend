import { prisma } from "../utils/prisma";
import { AbstractVoteDao } from "./abstractClasses/abstractVoteDao";

export class PostCommentVoteDao extends AbstractVoteDao {
  protected model = prisma.postCommentVote;
}