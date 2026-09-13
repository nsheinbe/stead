import { describe, expect, it } from "vitest";
import {
  allowDemoListings,
  assertDemoSeedAllowed,
  isHiddenSeedListing,
  isSeedHostId,
  isSeedListingId,
  SEED_HOST_ID,
  SEED_LISTING_IDS,
  SeedProductionError,
} from "../server/lib/seedInventory";

describe("allowDemoListings", () => {
  it("is on by default in development and test", () => {
    expect(allowDemoListings({ NODE_ENV: "development" })).toBe(true);
    expect(allowDemoListings({ NODE_ENV: "test" })).toBe(true);
    expect(allowDemoListings({})).toBe(true);
  });

  it("is off on Vercel production and NODE_ENV=production", () => {
    expect(allowDemoListings({ NODE_ENV: "production" })).toBe(false);
    expect(allowDemoListings({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(allowDemoListings({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("treats Vercel preview as production-like unless the flag is set", () => {
    expect(allowDemoListings({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(
      allowDemoListings({
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        ALLOW_DEMO_LISTINGS: "1",
      }),
    ).toBe(true);
  });

  it("lets ALLOW_DEMO_LISTINGS override either way", () => {
    expect(allowDemoListings({ NODE_ENV: "production", ALLOW_DEMO_LISTINGS: "1" })).toBe(true);
    expect(allowDemoListings({ NODE_ENV: "development", ALLOW_DEMO_LISTINGS: "0" })).toBe(false);
  });
});

describe("seed listing markers", () => {
  it("recognises the six Slice 1 ids and Nora", () => {
    expect(SEED_LISTING_IDS).toHaveLength(6);
    expect(isSeedListingId(SEED_LISTING_IDS[0])).toBe(true);
    expect(isSeedListingId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe(false);
    expect(isSeedHostId(SEED_HOST_ID)).toBe(true);
    expect(isSeedHostId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe(false);
  });

  it("hides those ids only when demo inventory is off", () => {
    expect(isHiddenSeedListing(SEED_LISTING_IDS[0], { NODE_ENV: "production" })).toBe(true);
    expect(isHiddenSeedListing(SEED_LISTING_IDS[0], { NODE_ENV: "development" })).toBe(false);
    expect(
      isHiddenSeedListing("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { NODE_ENV: "production" }),
    ).toBe(false);
  });
});

describe("assertDemoSeedAllowed", () => {
  it("allows a local laptop without extra flags", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "development", APP_URL: "http://localhost:5173" }),
    ).not.toThrow();
  });

  it("refuses production and openstead.app unless the flag is set", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production" })).toThrow(SeedProductionError);
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "development", APP_URL: "https://openstead.app" }),
    ).toThrow(/local and staging/);
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: "production",
        ALLOW_DEMO_LISTINGS: "1",
        APP_URL: "https://openstead.app",
      }),
    ).not.toThrow();
  });
});
