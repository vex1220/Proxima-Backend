import { Post } from "@prisma/client";
import { PostDao } from "../dao/PostDao";
import { CreatePostInput } from "../models/postTypes";
import { validatePost } from "../utils/postValidator";
import { PostCommentService } from "./PostCommentService";
import { VoteService } from "./VoteService";
import { VoteModel } from "../models/voteTypes";
import { getAllBlockRelatedUserIdsDao } from "../dao/BlockDao";

const postDao = new PostDao();
const postCommentService = new PostCommentService();
const postVoteService = new VoteService(VoteModel.PostVote);
const postCommentVoteService = new VoteService(VoteModel.PostCommentVote);

export class PostService {
  async createPost(data: CreatePostInput) {
    const { content, title } = validatePost(data.content, data.title, data.imageUrl);
    if (!title) {
      throw new Error("A title is required");
    }
    return await postDao.createPost({
      posterId: data.posterId,
      locationId: data.locationId,
      content: content ?? "",
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

  async getPostWithLocation(id: number) {
    if (!id || Number.isNaN(id)) {
      throw new Error("invalid post id");
    }
    return await postDao.getPostByIdWithLocation(id);
  }

  /** Returns posts for a location, filtered to hide posts from blocked users */
  async getPostListByLocation(locationId: number, viewerUserId?: number) {
    const posts = await postDao.getPostsByLocation(locationId);

    // If we have a viewer, filter out posts from users they've blocked (or who blocked them)
    const blockedUserIds = viewerUserId
      ? new Set(await getAllBlockRelatedUserIdsDao(viewerUserId))
      : new Set<number>();

    const visiblePosts = posts.filter((post) => !blockedUserIds.has(post.posterId));

    const postsWithVotes = await Promise.all(
      visiblePosts.map(async (post) => {
        const voteCount = await postVoteService.getVoteCount(post.id);
        return { ...post, voteCount };
      })
    );

    return postsWithVotes;
  }

  /** Returns a post and its comments, with blocked users' comments filtered out */
  async getPostandPostCommentsById(id: number, userId?: number) {
    const post = await postDao.getPostById(id);
    if (!post) {
      throw new Error("Cannot Find Post");
    }

    const postVotes = await postVoteService.getVoteCount(post.id);

    let userPostVote: number | null = null;
    if (userId) {
      userPostVote = await postVoteService.getUserVoteValue(userId, post.id);
    }

    const allComments = await postCommentService.getPostCommentsByPost(post.id);

    // Filter out comments from blocked users
    const blockedUserIds = userId
      ? new Set(await getAllBlockRelatedUserIdsDao(userId))
      : new Set<number>();

    const comments = allComments.filter(
      (comment) => !blockedUserIds.has(comment.commenterId)
    );

    const commentVotes = await Promise.all(
      comments.map((comment) => postCommentVoteService.getVoteCount(comment.id))
    );

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