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
const postCommentVoteService = new  VoteService(VoteModel.PostCommentVote);

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
      imageUrl: data.imageUrl,
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

  async getPostListByLocation(id: number) {
    const posts = await postDao.getPostsByLocation(id);

    // Attach vote counts to each post
    const postsWithVotes = await Promise.all(
      posts.map(async (post) => {
        const voteCount = await postVoteService.getVoteCount(post.id);
        return { ...post, voteCount };
      })
    );

    return postsWithVotes;
  }

  async getPostandPostCommentsById(id: number, userId?: number) {
    const post = await postDao.getPostById(id);
    if (!post) {
      throw new Error("Cannot Find Post");
    }

    const postVotes = await postVoteService.getVoteCount(post.id);

    // Get the current user's vote on this post (if logged in)
    let userPostVote: number | null = null;
    if (userId) {
      userPostVote = await postVoteService.getUserVoteValue(userId, post.id);
    }

    const comments = await postCommentService.getPostCommentsByPost(post.id);

    const commentVotes = await Promise.all(
      comments.map((comment) =>
        postCommentVoteService.getVoteCount(comment.id)
      )
    );

    // Batch-fetch the user's votes on all comments
    let userCommentVotes: Record<number, number> = {};
    if (userId && comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      userCommentVotes = await postCommentVoteService.getUserVotesForTargets(userId, commentIds);
    }

    const commentsWithVotes = comments.map((comment, idx) => ({
      ...comment,
      voteCount: commentVotes[idx],
      userVote: userCommentVotes[comment.id] ?? null,
    }));

    return {
      id: post.id,
      title: post.title,
      content: post.content,
      imageUrl: post.imageUrl,
      posterId: post.posterId,
      posterDisplayId: post.poster.displayId,
      postVotes: postVotes,
      userPostVote: userPostVote,
      createdAt: post.createdAt,
      commentCount: comments.length,
      comments: commentsWithVotes,
    };
  }
}