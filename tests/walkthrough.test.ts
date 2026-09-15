/**
 * HM-05 — what the walk decides before it loads a renderer.
 *
 * Pure, so the fallbacks are provable without a GPU: no WebGL means real
 * frames and no offer, reduced motion means real frames with an opt-in, and
 * the progress line counts megabytes rather than inventing a denominator.
 */
import { describe, expect, it } from "vitest";
import {
  detectWebgl,
  initialMode,
  megabytes,
  offersThreeD,
  prefersReducedMotion,
  progressParts,
  urlLikelyExpired,
} from "../src/lib/walkthrough";

describe("what this device can do", () => {
  it("says no when a context cannot be had, and never throws", () => {
    expect(detectWebgl({ createElement: () => ({ getContext: () => null }) as unknown as HTMLElement })).toBe(false);
    expect(
      detectWebgl({
        createElement: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });

  it("says yes when a context comes back, and releases it", () => {
    let released = false;
    const gl = {
      getExtension: (name: string) =>
        name === "WEBGL_lose_context" ? { loseContext: () => (released = true) } : null,
    };
    expect(detectWebgl({ createElement: () => ({ getContext: () => gl }) as unknown as HTMLElement })).toBe(true);
    expect(released).toBe(true);
  });

  it("reads the motion preference, and treats a throwing matchMedia as no preference", () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) as MediaQueryList })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("no matchMedia");
        },
      }),
    ).toBe(false);
  });
});

describe("what the walk shows first", () => {
  it("only walks in 3D when the device can and the guest has not asked otherwise", () => {
    expect(initialMode({ webgl: true, reducedMotion: false })).toBe("three_d");
    expect(initialMode({ webgl: true, reducedMotion: true })).toBe("stills");
    expect(initialMode({ webgl: false, reducedMotion: false })).toBe("stills");
    expect(initialMode({ webgl: false, reducedMotion: true })).toBe("stills");
  });

  it("offers the 3D opt-in only where there is something to opt into", () => {
    expect(offersThreeD({ webgl: true, reducedMotion: true }, "stills")).toBe(true);
    // Nothing to offer without a renderer, and nothing to offer while already in it.
    expect(offersThreeD({ webgl: false, reducedMotion: true }, "stills")).toBe(false);
    expect(offersThreeD({ webgl: true, reducedMotion: false }, "three_d")).toBe(false);
  });
});

describe("the progress line", () => {
  it("counts whole megabytes of the real transfer", () => {
    expect(megabytes(0)).toBe(0);
    expect(megabytes(12 * 1024 * 1024)).toBe(12);
    expect(megabytes(-5)).toBe(0);
    expect(progressParts({ loadedBytes: 12 * 1024 * 1024, totalBytes: 38 * 1024 * 1024 })).toEqual({
      loadedMb: 12,
      totalMb: 38,
    });
  });

  it("never invents a denominator, and never reports past the total", () => {
    expect(progressParts({ loadedBytes: 100, totalBytes: null })).toBeNull();
    expect(progressParts({ loadedBytes: 100, totalBytes: 0 })).toBeNull();
    expect(progressParts({ loadedBytes: 99 * 1024 * 1024, totalBytes: 38 * 1024 * 1024 })).toEqual({
      loadedMb: 38,
      totalMb: 38,
    });
  });
});

describe("a signed URL's life", () => {
  it("is treated as spent near the end of its window, not after it", () => {
    const issued = 1_000_000;
    expect(urlLikelyExpired(issued, 300, issued + 200_000)).toBe(false);
    expect(urlLikelyExpired(issued, 300, issued + 240_000)).toBe(true);
    expect(urlLikelyExpired(issued, 300, issued + 400_000)).toBe(true);
  });
});
