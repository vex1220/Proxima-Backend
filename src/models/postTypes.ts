export type CreatePostInput = {
    posterId: number,
    locationId?: number,
    latitude?: number,
    longitude?: number,
    title: string,
    content?: string,
    imageUrl?: string,
    wasAnonymous?: boolean,
};

export type createPostCommentInput = {
    commenterId: number,
    postId: number,
    content:string,
    imageUrl?: string,
    wasAnonymous?: boolean,
};
