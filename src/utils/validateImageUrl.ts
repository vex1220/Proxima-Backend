export function validateImageUrl(imageUrl?: string): string | undefined {
  if (!imageUrl) return undefined;
  const allowed = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  if (!imageUrl.startsWith(allowed)) {
    // Log for debugging but don't fail the whole post — just drop the image
    console.warn(`[validateImageUrl] Rejected non-S3 URL: ${imageUrl.slice(0, 60)}`);
    return undefined;
  }
  return imageUrl;
}