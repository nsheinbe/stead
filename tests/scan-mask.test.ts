/**
 * HM-04 — the host's marks, as arithmetic.
 *
 * The browser and the server both call these, and the worker drops frames by
 * the same rule, so a disagreement here is a private room in a walkthrough.
 */
import { describe, expect, it } from "vitest";
import {
  answerOf,
  coversWholeWalk,
  formatMoment,
  formatRange,
  isMasked,
  mergeSegments,
  MIN_SEGMENT_MS,
  stillAtMs,
  stillIndexAt,
  totalMaskedMs,
} from "../src/lib/scanMask";

const DURATION = 300_000;

describe("mergeSegments", () => {
  it("sorts, merges what touches, and leaves what does not", () => {
    expect(
      mergeSegments(
        [
          { fromMs: 60_000, toMs: 90_000 },
          { fromMs: 10_000, toMs: 20_000 },
          { fromMs: 85_000, toMs: 120_000 },
        ],
        DURATION,
      ),
    ).toEqual([
      { fromMs: 10_000, toMs: 20_000 },
      { fromMs: 60_000, toMs: 120_000 },
    ]);
  });

  it("merges ranges that only touch at the edge, so the total never double-counts", () => {
    const merged = mergeSegments(
      [
        { fromMs: 0, toMs: 10_000 },
        { fromMs: 10_000, toMs: 20_000 },
      ],
      DURATION,
    );
    expect(merged).toEqual([{ fromMs: 0, toMs: 20_000 }]);
    expect(totalMaskedMs(merged)).toBe(20_000);
  });

  it("swallows a range inside another", () => {
    expect(
      mergeSegments(
        [
          { fromMs: 10_000, toMs: 100_000 },
          { fromMs: 40_000, toMs: 50_000 },
        ],
        DURATION,
      ),
    ).toEqual([{ fromMs: 10_000, toMs: 100_000 }]);
  });

  it("clamps to the recording and drops a mark too short to cover a frame", () => {
    expect(mergeSegments([{ fromMs: 290_000, toMs: 999_000 }], DURATION)).toEqual([
      { fromMs: 290_000, toMs: 300_000 },
    ]);
    expect(mergeSegments([{ fromMs: 1000, toMs: 1000 + MIN_SEGMENT_MS - 1 }], DURATION)).toEqual([]);
    expect(mergeSegments([{ fromMs: -5000, toMs: 10_000 }], DURATION)).toEqual([{ fromMs: 0, toMs: 10_000 }]);
  });

  it("is idempotent: merging a merged list changes nothing", () => {
    const once = mergeSegments(
      [
        { fromMs: 5_000, toMs: 30_000 },
        { fromMs: 20_000, toMs: 25_000 },
        { fromMs: 120_000, toMs: 150_000 },
      ],
      DURATION,
    );
    expect(mergeSegments(once, DURATION)).toEqual(once);
  });

  it("keeps nothing when the walk has no measured length", () => {
    expect(mergeSegments([{ fromMs: 0, toMs: 10_000 }], 0)).toEqual([]);
  });
});

describe("coversWholeWalk", () => {
  it("is true only when the marks leave a guest nothing", () => {
    expect(coversWholeWalk([{ fromMs: 0, toMs: DURATION }], DURATION)).toBe(true);
    expect(coversWholeWalk([{ fromMs: 0, toMs: DURATION - 1000 }], DURATION)).toBe(false);
    expect(coversWholeWalk([], DURATION)).toBe(false);
  });

  it("does not add up overlapping marks into a false whole", () => {
    // Two marks that overlap heavily sum past the duration but cover half of it.
    const raw = [
      { fromMs: 0, toMs: 160_000 },
      { fromMs: 10_000, toMs: 170_000 },
    ];
    expect(totalMaskedMs(raw)).toBeGreaterThan(DURATION);
    expect(coversWholeWalk(mergeSegments(raw, DURATION), DURATION)).toBe(false);
  });

  it("is false when the duration is unknown, so a missing stat never blocks a host", () => {
    expect(coversWholeWalk([{ fromMs: 0, toMs: 10_000 }], 0)).toBe(false);
  });
});

describe("isMasked", () => {
  it("covers the start of a range and not its end, so neighbouring marks do not overlap", () => {
    const segments = [{ fromMs: 10_000, toMs: 20_000 }];
    expect(isMasked(segments, 9_999)).toBe(false);
    expect(isMasked(segments, 10_000)).toBe(true);
    expect(isMasked(segments, 19_999)).toBe(true);
    expect(isMasked(segments, 20_000)).toBe(false);
  });
});

describe("frames on the recording clock", () => {
  it("places the first and last still at the ends of the walk", () => {
    expect(stillAtMs(0, 8, DURATION)).toBe(0);
    expect(stillAtMs(7, 8, DURATION)).toBe(DURATION);
    expect(stillAtMs(3, 8, DURATION)).toBe(Math.round((3 / 7) * DURATION));
  });

  it("round-trips a still index through its moment", () => {
    for (let i = 0; i < 8; i += 1) {
      expect(stillIndexAt(stillAtMs(i, 8, DURATION), 8, DURATION)).toBe(i);
    }
  });

  it("holds a single still at the start, and never runs off either end", () => {
    expect(stillAtMs(0, 1, DURATION)).toBe(0);
    expect(stillIndexAt(0, 1, DURATION)).toBe(0);
    expect(stillIndexAt(-1000, 8, DURATION)).toBe(0);
    expect(stillIndexAt(DURATION * 2, 8, DURATION)).toBe(7);
    expect(stillIndexAt(1000, 0, DURATION)).toBe(0);
  });
});

describe("answerOf", () => {
  it("reads the row as one of three answers", () => {
    expect(answerOf(null)).toEqual({ kind: "none" });
    expect(answerOf({ wholeHomeConfirmedAt: null, segments: [] })).toEqual({ kind: "none" });
    expect(answerOf({ wholeHomeConfirmedAt: "2026-09-15T12:00:00.000Z", segments: [] })).toEqual({
      kind: "whole_home",
    });
    const segments = [{ fromMs: 0, toMs: 10_000 }];
    expect(answerOf({ wholeHomeConfirmedAt: null, segments })).toEqual({ kind: "segments", segments });
  });
});

describe("formatting", () => {
  it("shows mm:ss on the recording clock", () => {
    expect(formatMoment(0)).toBe("00:00");
    expect(formatMoment(80_000)).toBe("01:20");
    expect(formatMoment(-5)).toBe("00:00");
    expect(formatRange({ fromMs: 80_000, toMs: 105_000 })).toBe("01:20 – 01:45");
  });
});
