import { beforeAll, describe, expect, it } from "vitest";
import {
  extensionForImageType,
  listingPhotoKey,
  publicUrlForKey,
  StorageError,
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
