export interface Vote {
    value: number,
    userId: number,
    targetId: number
}

export enum VoteModel{
  PostVote = "postVote",
  ChatRoomMessageVote = "chatRoomMessageVote",
  PostCommentVote = "postCommentVote"
}