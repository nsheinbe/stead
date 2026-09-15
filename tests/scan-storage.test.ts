/** HM-02 — where a walk's objects go: deterministic keys under the scan prefix, strict types. */
import { describe, expect, it } from "vitest";
import {
  canonicalContentType,
  extensionForScanUpload,
  isVideoKeyFor,
  maxBytesFor,
  SCAN_MAX_PARTS,
  SCAN_MAX_VIDEO_BYTES,
  SCAN_PART_SIZE_BYTES,
  scanObjectKey,
  scanPrefix,
  validPartNumber,
} from "../server/lib/scanStorage";
import { StorageError } from "../server/lib/storage";

const LISTING = "3f1e0c9a-1111-4111-8111-111111111111";
const SCAN = "4a2e0c9a-2222-4222-8222-222222222222";

describe("scan object keys", () => {
  it("are deterministic and always under the scan's own prefix", () => {
    expect(scanPrefix(LISTING, SCAN)).toBe(`listings/${LISTING}/scans/${SCAN}/`);
    expect(scanObjectKey(LISTING, SCAN, "video", "video/mp4")).toBe(`listings/${LISTING}/scans/${SCAN}/video.mp4`);
    expect(scanObjectKey(LISTING, SCAN, "video", "video/webm;codecs=vp9")).toBe(
      `listings/${LISTING}/scans/${SCAN}/video.webm`,
    );
    expect(scanObjectKey(LISTING, SCAN, "attestation", "application/json")).toBe(
      `listings/${LISTING}/scans/${SCAN}/attestation.json`,
    );
    expect(scanObjectKey(LISTING, SCAN, "notes", "application/json")).toBe(`listings/${LISTING}/scans/${SCAN}/notes.json`);
  });

  it("refuses types that are not a video or JSON", () => {
    expect(() => extensionForScanUpload("video", "image/svg+xml")).toThrow(StorageError);
    expect(() => extensionForScanUpload("video", "application/octet-stream")).toThrow(StorageError);
    expect(() => extensionForScanUpload("attestation", "text/html")).toThrow(StorageError);
    expect(() => extensionForScanUpload("notes", "video/mp4")).toThrow(StorageError);
    expect(canonicalContentType("video", "video/webm;codecs=vp9")).toBe("video/webm");
    expect(canonicalContentType("attestation", "application/json")).toBe("application/json");
  });

  it("recognises only this scan's own video key", () => {
    expect(isVideoKeyFor(LISTING, SCAN, `listings/${LISTING}/scans/${SCAN}/video.mp4`)).toBe(true);
    expect(isVideoKeyFor(LISTING, SCAN, `listings/${LISTING}/scans/${SCAN}/video.webm`)).toBe(true);
    expect(isVideoKeyFor(LISTING, SCAN, `listings/${LISTING}/scans/${SCAN}/attestation.json`)).toBe(false);
    expect(isVideoKeyFor(LISTING, SCAN, `listings/${LISTING}/scans/other/video.mp4`)).toBe(false);
    expect(isVideoKeyFor(LISTING, SCAN, `listings/${LISTING}/scans/${SCAN}/video.exe`)).toBe(false);
    expect(isVideoKeyFor(LISTING, SCAN, `../listings/${LISTING}/scans/${SCAN}/video.mp4`)).toBe(false);
  });

  it("bounds parts and sizes to the D06 caps", () => {
    expect(SCAN_PART_SIZE_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(SCAN_MAX_PARTS * SCAN_PART_SIZE_BYTES).toBeGreaterThanOrEqual(SCAN_MAX_VIDEO_BYTES);
    expect(validPartNumber(1)).toBe(true);
    expect(validPartNumber(SCAN_MAX_PARTS)).toBe(true);
    expect(validPartNumber(0)).toBe(false);
    expect(validPartNumber(SCAN_MAX_PARTS + 1)).toBe(false);
    expect(validPartNumber(1.5)).toBe(false);
    expect(validPartNumber("1")).toBe(false);
    expect(maxBytesFor("video")).toBe(SCAN_MAX_VIDEO_BYTES);
    expect(maxBytesFor("attestation")).toBeLessThan(maxBytesFor("video"));
    expect(maxBytesFor("notes")).toBeLessThan(maxBytesFor("attestation"));
  });
});
