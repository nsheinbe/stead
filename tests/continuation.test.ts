import { describe, expect, it } from "vitest";
import {
  continuationLabel,
  DEFAULT_CONTINUATION,
  HOMEOWNER_CONTINUATION,
  isSafeContinuation,
  loginHref,
  normalizeContinuation,
  parseLoginContext,
} from "../src/lib/continuation";

describe("normalizeContinuation", () => {
  it("keeps known application paths", () => {
    expect(normalizeContinuation("/explore")).toBe("/explore");
    expect(normalizeContinuation("/book/44444444-4444-4444-4444-444444444444")).toBe(
      "/book/44444444-4444-4444-4444-444444444444",
    );
    expect(normalizeContinuation("/host/start")).toBe("/host/start");
    expect(normalizeContinuation("/messages/abc/def")).toBe("/messages/abc/def");
    expect(normalizeContinuation("/")).toBe("/");
  });

  it("keeps only the route's allowlisted query fields", () => {
    expect(normalizeContinuation("/explore?city=Hudson&guests=2&utm_source=x&redirect=//evil")).toBe(
      "/explore?city=Hudson&guests=2",
    );
    expect(normalizeContinuation("/host/listings?create=1")).toBe("/host/listings?create=1");
    expect(normalizeContinuation("/trips?anything=1")).toBe("/trips");
  });

  it("drops fragments and trailing slashes", () => {
    expect(normalizeContinuation("/explore/#top")).toBe("/explore");
    expect(normalizeContinuation("/trips/")).toBe("/trips");
  });

  it.each([
    ["absolute URL", "https://evil.example/"],
    ["protocol-relative", "//evil.example/trips"],
    ["backslash protocol-relative", "/\\evil.example"],
    ["backslash inside", "/trips\\..\\host"],
    ["encoded slash", "/%2fevil.example"],
    ["encoded backslash", "/%5cevil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative path", "explore"],
    ["control character", "/trips\nX"],
    ["null byte", "/trips%00"],
    ["unknown route", "/admin"],
    ["api route", "/api/me"],
    ["auth loop", "/login"],
    ["auth loop with query", "/login?next=/trips"],
    ["nested login", "/login/verify"],
    ["empty", ""],
    ["oversized id", `/listing/${"a".repeat(65)}`],
    ["too long", `/explore?q=${"a".repeat(2100)}`],
  ])("falls back on %s", (_label, raw) => {
    expect(normalizeContinuation(raw)).toBe(DEFAULT_CONTINUATION);
    expect(isSafeContinuation(raw)).toBe(false);
  });

  it("falls back on non-string input", () => {
    expect(normalizeContinuation(null)).toBe(DEFAULT_CONTINUATION);
    expect(normalizeContinuation(undefined)).toBe(DEFAULT_CONTINUATION);
    expect(normalizeContinuation(42)).toBe(DEFAULT_CONTINUATION);
  });

  it("uses a caller fallback when it is itself safe", () => {
    expect(normalizeContinuation("//evil", "/host/start")).toBe("/host/start");
    expect(normalizeContinuation("//evil", "//also-evil")).toBe(DEFAULT_CONTINUATION);
  });

  it("drops over-long or control-laden query values without rejecting the path", () => {
    expect(normalizeContinuation(`/explore?q=${"a".repeat(201)}`)).toBe("/explore");
    // A tab decodes to a control character: the value goes, the route stays.
    expect(normalizeContinuation("/explore?q=a%09b")).toBe("/explore");
    // Encoded newlines are refused outright, wherever they appear.
    expect(normalizeContinuation("/explore?q=a%0Ab")).toBe(DEFAULT_CONTINUATION);
  });
});

describe("loginHref", () => {
  it("omits the default destination and unknown labels", () => {
    expect(loginHref()).toBe("/login");
    expect(loginHref({ next: "/trips" })).toBe("/login");
    expect(loginHref({ next: "/trips", intent: "unknown", source: "unknown" })).toBe("/login");
  });

  it("carries a safe destination with intent and source", () => {
    expect(loginHref({ next: "/host/start", intent: "homeowner", source: "homeowner_hero" })).toBe(
      "/login?next=%2Fhost%2Fstart&intent=homeowner&source=homeowner_hero",
    );
  });

  it("never carries an unsafe destination", () => {
    expect(loginHref({ next: "//evil.example" })).toBe("/login");
    expect(loginHref({ next: "/login?next=/trips" })).toBe("/login");
  });

  it("drops labels outside the allowlist", () => {
    // @ts-expect-error runtime guard for values arriving from URLs
    expect(loginHref({ next: "/explore", intent: "admin", source: "<script>" })).toBe("/login?next=%2Fexplore");
  });
});

describe("parseLoginContext", () => {
  it("reads a valid context back", () => {
    expect(parseLoginContext("?next=%2Fhost%2Fstart&intent=homeowner&source=header")).toEqual({
      next: "/host/start",
      intent: "homeowner",
      source: "header",
    });
  });

  it("defaults a homeowner intent to the listing flow, everyone else to stays", () => {
    expect(parseLoginContext("?intent=homeowner").next).toBe(HOMEOWNER_CONTINUATION);
    expect(parseLoginContext("?intent=homeowner&next=//evil").next).toBe(HOMEOWNER_CONTINUATION);
    expect(parseLoginContext("").next).toBe(DEFAULT_CONTINUATION);
    expect(parseLoginContext("?next=%2Flogin").next).toBe(DEFAULT_CONTINUATION);
  });

  it("normalises bogus labels to unknown", () => {
    const context = parseLoginContext("?intent=owner&source=evil");
    expect(context.intent).toBe("unknown");
    expect(context.source).toBe("unknown");
  });
});

describe("continuationLabel", () => {
  it("names the destination in the member's terms", () => {
    expect(continuationLabel("/book/abc")).toBe("Continue to your stay");
    expect(continuationLabel("/host/start")).toBe("Continue your listing");
    expect(continuationLabel("/host/listings/abc?setup=photos")).toBe("Continue your listing");
    expect(continuationLabel("/messages/abc")).toBe("Open conversation");
    expect(continuationLabel("/host/payouts")).toBe("Continue to hosting tools");
    expect(continuationLabel("/trips")).toBe("Continue to your stays");
    expect(continuationLabel("/explore")).toBe("Continue");
  });
});
