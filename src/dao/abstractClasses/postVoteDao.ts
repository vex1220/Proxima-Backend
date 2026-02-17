import { prisma } from "../../utils/prisma";
import { AbstractVoteDao } from "./abstractVoteDao";


export class PostVoteDao extends AbstractVoteDao {
  protected model = prisma.postVote;
}