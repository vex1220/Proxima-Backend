import { PostService } from "../services/PostService";
import { LocationService } from "../services/LocationService";
import { verifyLocationAndUserInRange } from "../utils/locationUtils";
import { withAuth } from "../utils/handler";
import { PostCommentService } from "../services/PostCommentService";
import { VoteModel } from "../models/voteTypes";
import { VoteService } from "../services/VoteService";
import { validateNotOwnPost, constructVote } from "../utils/voteUtils";
import { updateUserKarma } from "../services/userService";
import { validateImageUrl } from "../utils/validateImageUrl";


const postService = new PostService();
const locationService = new LocationService();
const postCommentService = new PostCommentService();
const postVoteService = new VoteService(VoteModel.PostVote);
const postCommentVoteService = new VoteService(VoteModel.PostCommentVote);

export const createPost = withAuth(async (req, res) => {
  try {
    const { locationId, title, content, imageUrl: rawImageUrl } = req.body;
    const user = req.user;
    const imageUrl = validateImageUrl(rawImageUrl) ?? undefined;

    const location = await locationService.getLocationById(locationId);
    if (!location) {
      return res.status(400).json({ message: "invalid locationId" });
    }

    if (
      location.latitude != null &&
      location.longitude != null &&
      location.size != null
    ) {
      if (
        !(await verifyLocationAndUserInRange(location, user.id)) &&
        !user.isAdmin
      ) {
        return res
          .status(403)
          .json({ message: "user out of range to post in this chatroom" });
      }
    } else {
      if (!user.isAdmin) {
        return res
          .status(400)
          .json({ message: "the specified location does not support user location" });
      }
    }

    const createdPost = await postService.createPost({
      posterId: user.id,
      locationId,
      title,
      content,
      imageUrl,
    });

    const postList = await postService.getPostListByLocation(locationId);

    return res.status(201).json({
      message: `successfully posted`,
      createdPost,
      postList,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
});

export const postDetails = withAuth(async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const user = req.user;

    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ message: "invalid post Id" });
    }

    const payload = await postService.getPostandPostCommentsById(postId, user.id);

    if (!payload) {
      return res.status(404).json({ message: "post not found" });
    }

    return res.status(200).json({ payload });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export const commentOnPost = withAuth(async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { content, imageUrl: rawImageUrl } = req.body;
    const user = req.user;
    const imageUrl = validateImageUrl(rawImageUrl) ?? undefined;

    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ message: "invalid post Id" });
    }

    const post = await postService.getPostWithLocation(postId);

    if (!post?.location) {
      return res.status(400).json({ message: "invalid post location" });
    }

    if (
      post?.location?.latitude != null &&
      post?.location?.longitude != null &&
      post?.location?.size != null
    ) {
      if (
        !(await verifyLocationAndUserInRange(post?.location, user.id)) &&
        !user.isAdmin
      ) {
        return res
          .status(403)
          .json({ message: "user out of range to post in this chatroom" });
      }
    } else {
      if (!user.isAdmin) {
        return res
          .status(400)
          .json({ message: "the specified location does not support user location" });
      }
    }

    const createdComment = await postCommentService.createPostComment({
      commenterId: user.id,
      postId: post.id,
      content,
      imageUrl,
    });

    const updatedPost = await postService.getPostandPostCommentsById(post.id);

    return res.status(201).json({
      message: "Post comment added",
      createdComment,
      updatedPost,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export const voteOnPost = withAuth(async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { vote } = req.body;
    const user = req.user;

    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ message: "invalid post Id" });
    }

    const post = await postService.getPostWithLocation(postId);
    if (!post) {
      return res.status(404).json({ message: "post not found" });
    }

    try {
      validateNotOwnPost(user.id, post.posterId);
    } catch {
      return res.status(403).json({ message: "cannot vote on your own post" });
    }

    // Fetch existing vote first so we can compute the karma delta
    const existingVote = await postVoteService.getVote(
      constructVote(0, user.id, postId)
    );
    const oldValue = existingVote?.value ?? 0;

    const constructedVote = constructVote(vote.value, user.id, postId);
    await postVoteService.voteOnMessage(constructedVote);

    // Apply karma delta to the post author (handles first vote, switching, and no-ops)
    const karmaDelta = vote.value - oldValue;
    if (karmaDelta !== 0) {
      await updateUserKarma(post.posterId, karmaDelta);
    }

    return res.status(201).json({ message: "voted successfully" });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export const voteOnComment = withAuth(async (req, res) => {
  try {
    const commentId = Number(req.params.id);
    const { vote } = req.body;
    const user = req.user;

    if (!commentId || Number.isNaN(commentId)) {
      return res.status(400).json({ message: "invalid comment Id" });
    }

    const comment = await postCommentService.getPostCommentById(commentId);
    if (!comment) {
      return res.status(404).json({ message: "comment not found" });
    }

    try {
      validateNotOwnPost(user.id, comment.commenterId);
    } catch {
      return res.status(403).json({ message: "cannot vote on your own comment" });
    }

    // Fetch existing vote first so we can compute the karma delta
    const existingVote = await postCommentVoteService.getVote(
      constructVote(0, user.id, commentId)
    );
    const oldValue = existingVote?.value ?? 0;

    const constructedVote = constructVote(vote.value, user.id, commentId);
    await postCommentVoteService.voteOnMessage(constructedVote);

    // Apply karma delta to the comment author
    const karmaDelta = vote.value - oldValue;
    if (karmaDelta !== 0) {
      await updateUserKarma(comment.commenterId, karmaDelta);
    }

    return res.status(201).json({ message: "voted successfully" });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export const deletePostVote = withAuth(async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const user = req.user;

    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ message: "invalid post Id" });
    }

    const post = await postService.getPostWithLocation(postId);
    if (!post) {
      return res.status(404).json({ message: "post not found" });
    }

    const existingVote = await postVoteService.getVote(
      constructVote(0, user.id, postId)
    );

    if (!existingVote) {
      return res.status(200).json({ message: "no vote to remove" });
    }

    await postVoteService.removeVote(constructVote(0, user.id, postId));

    // Reverse exactly the karma that was applied when the vote was cast
    await updateUserKarma(post.posterId, -existingVote.value);

    return res.status(200).json({ message: "vote removed successfully" });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export const deleteCommentVote = withAuth(async (req, res) => {
  try {
    const commentId = Number(req.params.id);
    const user = req.user;

    if (!commentId || Number.isNaN(commentId)) {
      return res.status(400).json({ message: "invalid comment Id" });
    }

    const comment = await postCommentService.getPostCommentById(commentId);
    if (!comment) {
      return res.status(404).json({ message: "comment not found" });
    }

    const existingVote = await postCommentVoteService.getVote(
      constructVote(0, user.id, commentId)
    );

    if (!existingVote) {
      return res.status(200).json({ message: "no vote to remove" });
    }

    await postCommentVoteService.removeVote(constructVote(0, user.id, commentId));

    // Reverse exactly the karma that was applied when the vote was cast
    await updateUserKarma(comment.commenterId, -existingVote.value);

    return res.status(200).json({ message: "vote removed successfully" });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});