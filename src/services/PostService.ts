import { Post } from "@prisma/client";
import { PostDao } from "../dao/PostDao";
import { CreatePostInput } from "../models/postTypes";
import { validatePost } from "../utils/postValidator";
import { PostCommentService } from "./PostCommentService";
import { VoteService } from "./VoteService";
import { VoteModel } from "../models/voteTypes";

const postDao = new PostDao();
const postCommentService = new PostCommentService();
const postVoteService = new  VoteService(VoteModel.PostVote);
const postCommentVoteService = new  VoteService(VoteModel.PostVote);

export class PostService {
  async createPost(data: CreatePostInput) {
    const { content, title } = validatePost(data.content, data.title);
    if (!title) {
      throw new Error("A title is required");
    }
    return await postDao.createPost({
      posterId: data.posterId,
      locationId: data.locationId,
      content,
      title,
    });
  }

  async deletePost(id: number) {
    return await postDao.deletePost(id);
  }

  async getPostById(id: number) {
    if (!id || Number.isNaN(id)) {
      throw new Error("invalid post id");
    }
    return await postDao.getPostById(id);
  }

  async getPostWithLocation(id:number) {
    if (!id || Number.isNaN(id)) {
      throw new Error("invalid post id");
    }
    return await postDao.getPostByIdWithLocation(id);
  }

  async getPostListByLocation(id:number){
    return await postDao.getPostsByLocation(id);
  }

  async getPostandPostCommentsById(id:number){
    const post = await postDao.getPostById(id);
    if(!post){
      throw new Error("Cannot Find Post");
    }

    const postVotes = await postVoteService.getVoteCount(post.id);

    const comments = await postCommentService.getPostCommentsByPost(post.id);

    const commentVotes = await Promise.all(
      comments.map((comment) =>
        postCommentVoteService.getVoteCount(comment.id)
    )); 

    const commentsWithVotes = comments.map((comment, idx) => ({
      ...comment,
      voteCount: commentVotes[idx]
    }));

    return {
      id:post.id,
      title:post.title,
      content:post.content,
      posterId: post.posterId,
      posterDisplayId: post.poster.displayId,
      postVotes: postVotes,
      createdAt: post.createdAt,
      commentCount: comments.length,
      comments: commentsWithVotes,
    };
  }
}
