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
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Extension is derived from the signed content type, never from a filename. */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Video parts of an honesty scan (HM-02). The browser records
 * `video/webm;codecs=vp9` or `video/mp4;codecs=avc1`; the signed content type
 * is the base type, so the PUT header is exact and the codec string lives in
 * the manifest instead.
 */
const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
};

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

export function claimEvidenceKey(claimId: string, contentType: string): string {
  return `claims/${claimId}/${randomUUID()}.${extensionForImageType(contentType)}`;
}

/** `video/webm;codecs=vp9` → `video/webm`. Throws for anything but the two allowed bases. */
export function videoBaseType(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_VIDEO_TYPES[base]) {
    throw new StorageError(`Unsupported video type: ${mimeType}`);
  }
  return base;
}

/**
 * Everything a scan uploads lives under its own prefix, which is private:
 * nothing here gets a public URL, and the bucket policy must not make
 * `listings/*\/scans/*` readable (README "Object storage"). Part keys are
 * deterministic — the scan id is the secret, the seq is the order the worker
 * concatenates them in — so a resumed upload targets the same object.
 */
export function scanPrefix(listingId: string, scanId: string): string {
  return `listings/${listingId}/scans/${scanId}/`;
}

export function scanVideoPartKey(listingId: string, scanId: string, seq: number, mimeType: string): string {
  if (!Number.isInteger(seq) || seq < 0) throw new StorageError("Part sequence must be a whole number");
  const ext = ALLOWED_VIDEO_TYPES[videoBaseType(mimeType)]!;
  return `${scanPrefix(listingId, scanId)}video/part-${String(seq).padStart(5, "0")}.${ext}`;
}

export function scanManifestKey(listingId: string, scanId: string): string {
  return `${scanPrefix(listingId, scanId)}manifest.json`;
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

/**
 * A short-lived PUT URL for one video part. Same shape as the image presign:
 * the key and the content type are the server's; the client supplies bytes.
 * Size is not enforced by the signature — the receipt is `headObjectSize`
 * afterwards, compared to what was declared.
 */
export async function presignScanPartUpload(key: string, mimeType: string): Promise<PresignedUpload> {
  const contentType = videoBaseType(mimeType);
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET as string,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  // No public URL: scan objects are private. The field is kept for the shape
  // and carries the key, not a fetchable address.
  return { uploadUrl, key, publicUrl: key, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/** The receipt: what is actually in the bucket at this key, or null if nothing is. */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const head = await getClient().send(
      new HeadObjectCommand({ Bucket: process.env.S3_BUCKET as string, Key: key }),
    );
    return typeof head.ContentLength === "number" ? head.ContentLength : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) return null;
    throw err;
  }
}

/** Server-side write of a small JSON object (the scan manifest). */
export async function putJsonObject(key: string, body: unknown): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET as string,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: "application/json",
    }),
  );
}
