export function validateImageUrl(imageUrl?: string): string | undefined {
  if (!imageUrl) return undefined;
  const allowed = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  if (!imageUrl.startsWith(allowed)) {
    throw new Error("Invalid image URL");
  }
  return imageUrl;
}