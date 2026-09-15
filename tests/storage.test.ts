import { beforeAll, describe, expect, it } from "vitest";
import {
  claimEvidenceKey,
  extensionForImageType,
  listingPhotoKey,
  publicUrlForKey,
  scanManifestKey,
  scanPrefix,
  scanVideoPartKey,
  StorageError,
  videoBaseType,
} from "../server/lib/storage";

beforeAll(() => {
  process.env.S3_PUBLIC_URL = "https://cdn.example.test/stead/";
});

describe("upload keys", () => {
  it("derives the extension from the signed content type, not a filename", () => {
    expect(extensionForImageType("image/jpeg")).toBe("jpg");
    expect(extensionForImageType("image/png")).toBe("png");
    expect(extensionForImageType("image/webp")).toBe("webp");
  });

  it("refuses anything that is not an allowed image type", () => {
    // The realistic attempt: dress an executable or an SVG (which can carry
    // script) as an upload.
    expect(() => extensionForImageType("image/svg+xml")).toThrow(StorageError);
    expect(() => extensionForImageType("text/html")).toThrow(StorageError);
    expect(() => extensionForImageType("application/octet-stream")).toThrow(StorageError);
    expect(() => extensionForImageType("")).toThrow(StorageError);
  });

  it("puts claim evidence under the claim's prefix", () => {
    const claimId = "4a2e0c9a-2222-4222-8222-222222222222";
    const key = claimEvidenceKey(claimId, "image/webp");
    expect(key.startsWith(`claims/${claimId}/`)).toBe(true);
    expect(key.endsWith(".webp")).toBe(true);
  });

  it("puts every object under its own listing's prefix", () => {
    const listingId = "3f1e0c9a-1111-4111-8111-111111111111";
    const key = listingPhotoKey(listingId, "image/jpeg");
    expect(key.startsWith(`listings/${listingId}/`)).toBe(true);
    expect(key.endsWith(".jpg")).toBe(true);
  });

  it("never repeats a key for the same listing", () => {
    const listingId = "3f1e0c9a-1111-4111-8111-111111111111";
    const keys = new Set(
      Array.from({ length: 50 }, () => listingPhotoKey(listingId, "image/png")),
    );
    expect(keys.size).toBe(50);
  });

  it("builds a public URL without doubling the separator", () => {
    expect(publicUrlForKey("listings/a/b.jpg")).toBe("https://cdn.example.test/stead/listings/a/b.jpg");
  });
});

describe("honesty scan keys (HM-02)", () => {
  const listingId = "3f1e0c9a-1111-4111-8111-111111111111";
  const scanId = "9b7d0c9a-3333-4333-8333-333333333333";

  it("takes the base video type and refuses anything else", () => {
    expect(videoBaseType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(videoBaseType("VIDEO/MP4; codecs=avc1")).toBe("video/mp4");
    expect(() => videoBaseType("video/x-matroska")).toThrow(StorageError);
    expect(() => videoBaseType("image/jpeg")).toThrow(StorageError);
    expect(() => videoBaseType("text/html")).toThrow(StorageError);
    expect(() => videoBaseType("")).toThrow(StorageError);
  });

  it("puts every scan object under the scan's own private prefix, in order", () => {
    expect(scanPrefix(listingId, scanId)).toBe(`listings/${listingId}/scans/${scanId}/`);
    expect(scanVideoPartKey(listingId, scanId, 0, "video/webm;codecs=vp9")).toBe(
      `listings/${listingId}/scans/${scanId}/video/part-00000.webm`,
    );
    expect(scanVideoPartKey(listingId, scanId, 1234, "video/mp4")).toBe(
      `listings/${listingId}/scans/${scanId}/video/part-01234.mp4`,
    );
    expect(scanManifestKey(listingId, scanId)).toBe(`listings/${listingId}/scans/${scanId}/manifest.json`);
    // Deterministic: a resumed upload targets the same object.
    expect(scanVideoPartKey(listingId, scanId, 3, "video/webm")).toBe(scanVideoPartKey(listingId, scanId, 3, "video/webm"));
  });

  it("refuses a sequence that is not a whole number", () => {
    expect(() => scanVideoPartKey(listingId, scanId, -1, "video/webm")).toThrow(StorageError);
    expect(() => scanVideoPartKey(listingId, scanId, 1.5, "video/webm")).toThrow(StorageError);
  });
});
