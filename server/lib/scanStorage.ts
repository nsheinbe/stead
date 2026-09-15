/**
 * HM-02 — where a walk's objects go, and how the browser gets them there.
 *
 * Same contract as listing photos (server/lib/storage.ts): the server chooses
 * the key and signs the content type; the browser PUTs straight to the bucket;
 * the Hono function never sees the bytes. Two differences:
 *
 *  - Keys are deterministic under the scan's own prefix
 *    (listings/:listingId/scans/:scanId/<kind>.<ext>). The scan id is a
 *    server-issued uuid, so a client cannot land an object anywhere else, and
 *    completion knows exactly which three objects to look for.
 *  - Video goes up as an S3 multipart upload (DECISIONS D06): the server
 *    creates the upload, signs each part's PUT on request, and completes it
 *    by listing the parts itself — so the browser never has to read an ETag
 *    response header and the bucket needs no extra CORS exposure.
 *
 * Size caps are enforced at completion by reading the object's size from the
 * bucket, because a presigned PUT carries no limit.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ScanUploadKind, ScanWorkerArtifactKind } from "../../src/lib/types";
import { getStorageClient, StorageError } from "./storage";

/** Extension is derived from the signed content type, never from a filename. */
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const JSON_TYPE = "application/json";

export const SCAN_PART_SIZE_BYTES = 8 * 1024 * 1024; // ≥ S3's 5 MiB minimum
export const SCAN_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // D06: 2 GiB
export const SCAN_MAX_PARTS = Math.ceil(SCAN_MAX_VIDEO_BYTES / SCAN_PART_SIZE_BYTES); // 256
export const SCAN_MAX_ATTESTATION_BYTES = 5 * 1024 * 1024;
export const SCAN_MAX_NOTES_BYTES = 256 * 1024;
export const SCAN_URL_TTL_SECONDS = 300;

export function maxBytesFor(kind: ScanUploadKind): number {
  if (kind === "video") return SCAN_MAX_VIDEO_BYTES;
  if (kind === "attestation") return SCAN_MAX_ATTESTATION_BYTES;
  return SCAN_MAX_NOTES_BYTES;
}

export function extensionForScanUpload(kind: ScanUploadKind, contentType: string): string {
  if (kind === "video") {
    const ext = VIDEO_TYPES[contentType.split(";")[0]?.trim() ?? ""];
    if (!ext) throw new StorageError(`Unsupported video type: ${contentType}`);
    return ext;
  }
  if (contentType !== JSON_TYPE) throw new StorageError(`Unsupported type for ${kind}: ${contentType}`);
  return "json";
}

/** The canonical content type stored for a kind (a codec suffix on video is dropped). */
export function canonicalContentType(kind: ScanUploadKind, contentType: string): string {
  extensionForScanUpload(kind, contentType);
  return kind === "video" ? (contentType.split(";")[0]?.trim() as string) : JSON_TYPE;
}

export function scanPrefix(listingId: string, scanId: string): string {
  return `listings/${listingId}/scans/${scanId}/`;
}

/** Deterministic: one object per kind per scan, always under the scan prefix. */
export function scanObjectKey(
  listingId: string,
  scanId: string,
  kind: ScanUploadKind,
  contentType: string,
): string {
  return `${scanPrefix(listingId, scanId)}${kind}.${extensionForScanUpload(kind, contentType)}`;
}

/** Stills the status page shows for a failed scan (HM-D04 §3): real frames, at most this many. */
export const SCAN_MAX_STILLS = 8;

export const WORKER_ARTIFACT_KINDS: readonly ScanWorkerArtifactKind[] = [
  "frames",
  "cameras",
  "splat",
  "splat_compressed",
  "stills",
];

/** A key the worker may record: under this scan's prefix, no traversal, not empty. */
export function isWorkerKeyFor(listingId: string, scanId: string, key: string): boolean {
  const prefix = scanPrefix(listingId, scanId);
  return key.startsWith(prefix) && key.length > prefix.length && !key.includes("..") && !key.endsWith("/");
}

export function isVideoKeyFor(listingId: string, scanId: string, key: string): boolean {
  const prefix = `${scanPrefix(listingId, scanId)}video.`;
  return key.startsWith(prefix) && Object.values(VIDEO_TYPES).includes(key.slice(prefix.length));
}

export function validPartNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= SCAN_MAX_PARTS;
}

function bucket(): string {
  return process.env.S3_BUCKET as string;
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const out = await getStorageClient().send(
    new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
  );
  if (!out.UploadId) throw new StorageError("The bucket did not start the upload");
  return out.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const uploadUrl = await getSignedUrl(
    getStorageClient(),
    new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: SCAN_URL_TTL_SECONDS },
  );
  return { uploadUrl, expiresInSeconds: SCAN_URL_TTL_SECONDS };
}

export type UploadedPart = { partNumber: number; sizeBytes: number; etag: string };

/** Every part the bucket holds for this upload, in part order. Paginates past 1,000. */
export async function listUploadedParts(key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = [];
  let marker: number | undefined;
  for (let page = 0; page < 20; page += 1) {
    const out = await getStorageClient().send(
      new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker?.toString() }),
    );
    for (const part of out.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({ partNumber: part.PartNumber, sizeBytes: part.Size ?? 0, etag: part.ETag });
      }
    }
    if (!out.IsTruncated || !out.NextPartNumberMarker) break;
    marker = Number(out.NextPartNumberMarker);
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** Complete from the bucket's own part list, so the browser never reports ETags. */
export async function completeMultipartUpload(key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts = await listUploadedParts(key, uploadId);
  if (parts.length === 0) throw new StorageError("No parts were uploaded");
  await getStorageClient().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  );
  return parts;
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await getStorageClient().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
}

export async function presignPutObject(
  key: string,
  contentType: string,
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const uploadUrl = await getSignedUrl(
    getStorageClient(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: SCAN_URL_TTL_SECONDS },
  );
  return { uploadUrl, expiresInSeconds: SCAN_URL_TTL_SECONDS };
}

/** A short-lived GET for one object — how a host sees a still, how nobody sees a raw key. */
export async function presignGetObject(key: string): Promise<{ url: string; expiresInSeconds: number }> {
  const url = await getSignedUrl(getStorageClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: SCAN_URL_TTL_SECONDS,
  });
  return { url, expiresInSeconds: SCAN_URL_TTL_SECONDS };
}

export type ObjectHead = { sizeBytes: number; contentType: string };

/** null when the object is not there — the honest "didn't finish uploading". */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const out = await getStorageClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType ?? "" };
  } catch (err) {
    const name = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) return null;
    throw err;
  }
}

/** Read a small JSON object (the attestation). Refuses anything over `maxBytes`. */
export async function getObjectText(key: string, maxBytes: number): Promise<string> {
  const out = await getStorageClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if ((out.ContentLength ?? 0) > maxBytes) throw new StorageError("Object is larger than allowed");
  const body = out.Body as { transformToString?: (encoding?: string) => Promise<string> } | undefined;
  if (!body?.transformToString) throw new StorageError("Object body was not readable");
  const text = await body.transformToString("utf8");
  if (text.length > maxBytes) throw new StorageError("Object is larger than allowed");
  return text;
}
