import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const Bucket = process.env.S3_BUCKET!;

/** Browser uploads straight to S3 with this, bypassing Vercel's body limit. */
export function signUpload(key: string, contentType: string, expiresIn = 15 * 60) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
    expiresIn,
  });
}

/** Playback / share pages / Deepgram fetch. Signed locally, no AWS round trip. */
export function signDownload(key: string, expiresIn = 6 * 60 * 60) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
}

/** Best effort: a missing s3:DeleteObject permission shouldn't block deleting the meeting itself. */
export async function deleteObject(key: string) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    return true;
  } catch (err) {
    console.warn(`[storage] could not delete ${key}:`, err instanceof Error ? err.name : err);
    return false;
  }
}
