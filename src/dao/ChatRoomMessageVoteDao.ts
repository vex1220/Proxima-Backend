import {prisma} from "../utils/prisma";
import { AbstractVoteDao } from "./abstractClasses/abstractVoteDao";

export class ChatRoomMessageVoteDao extends AbstractVoteDao {
  protected model = prisma.chatRoomMessageVote;
}
