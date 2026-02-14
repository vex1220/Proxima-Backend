import { Post } from "@prisma/client";
import { PostDao } from "../dao/PostDao";
import { CreatePostInput } from "../models/postTypes";
import { validatePost } from "../utils/postValidator";
import { PostCommentService } from "./PostCommentService";

const postDao = new PostDao();
const postCommentService = new PostCommentService();

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
    return await postDao.getPostById(id);
  }

  async getPostAndPostCommentsByLocation(id: number) {
    const posts = await postDao.getPostsByLocation(id);

    const postComments = await Promise.all(
      posts.map((post) => postCommentService.getPostCommentsByPost(post.id)),
    );

    return posts.map((post: Post, idx) => ({
      ...post,
      comments: postComments[idx],
    }));
  }
}
