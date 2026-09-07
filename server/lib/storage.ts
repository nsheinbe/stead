/**
 * Presigned uploads to any S3-compatible bucket (AWS, R2, B2, MinIO locally),
 * configured through the S3_* variables in .env.example.
 *
 * The browser uploads straight to the bucket, so the API never proxies image
 * bytes. What it does keep is control of the object key and the content type:
 * both are signed, so a client cannot choose where its file lands or claim it
 * is something it is not.
 */
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Extension is derived from the signed content type, never from a filename. */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const UPLOAD_URL_TTL_SECONDS = 300;

export class StorageError extends Error {}

export function storageConfigured(): boolean {
  return Boolean(
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
  );
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (client) return client;
  if (!storageConfigured()) {
    throw new StorageError("Object storage is not configured on this deployment");
  }
  client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    // Unset for AWS; set to the MinIO or R2 endpoint otherwise.
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    // MinIO needs path style; AWS does not.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
    },
  });
  return client;
}

export function extensionForImageType(contentType: string): string {
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    throw new StorageError(`Unsupported image type: ${contentType}`);
  }
  return ext;
}

/**
 * The key is built here, from ids the server already trusts plus a random
 * segment — never from anything the client sent. That is what stops one host
 * writing into another's prefix, or a "../" ever reaching the bucket.
 */
export function listingPhotoKey(listingId: string, contentType: string): string {
  return `listings/${listingId}/${randomUUID()}.${extensionForImageType(contentType)}`;
}

export function publicUrlForKey(key: string): string {
  const base = process.env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  if (!base) {
    throw new StorageError("S3_PUBLIC_URL is not set, so uploads would not be readable");
  }
  return `${base}/${key}`;
}

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresInSeconds: number;
}

/**
 * A short-lived PUT URL for exactly one object of exactly one content type.
 *
 * Note what this cannot do: a plain presigned PUT carries no size limit, so a
 * bucket policy or a proxy is what caps upload size. Keep the TTL short.
 */
export async function presignImageUpload(
  key: string,
  contentType: string,
): Promise<PresignedUpload> {
  extensionForImageType(contentType);
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET as string,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return {
    uploadUrl,
    key,
    publicUrl: publicUrlForKey(key),
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}
