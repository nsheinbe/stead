/**
 * HM-01 — the capture page's logic: readouts, the on-device meter, and the
 * rule that Finish is not a verdict.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SCAN_THRESHOLDS } from "../server/lib/geofence";
import {
  bookendMeter,
  captureSupport,
  FINISH_REASON,
  formatElapsed,
  guidanceAt,
  readoutFor,
  SampleBuffer,
  type CaptureSample,
} from "../src/lib/scanCapture";

const T = DEFAULT_SCAN_THRESHOLDS;

function samples(count: number, fromMs: number, acc: number, stepMs = 1000): CaptureSample[] {
  return Array.from({ length: count }, (_, i) => ({ t: fromMs + i * stepMs, lat: 1, lng: 2, acc }));
}

describe("readoutFor", () => {
  it("never says 'at this home' — only good, rough, waiting, off", () => {
    expect(readoutFor({ acc: 8 }, "granted", T)).toBe("Location: good (about 10 m)");
    expect(readoutFor({ acc: 62 }, "granted", T)).toMatch(/^Location: rough/);
    expect(readoutFor(null, "granted", T)).toMatch(/waiting for your phone/);
    expect(readoutFor({ acc: 3 }, "denied", T)).toMatch(/^Location: off/);
    for (const text of [
      readoutFor({ acc: 8 }, "granted", T),
      readoutFor(null, "prompt", T),
      readoutFor({ acc: 3 }, "denied", T),
    ]) {
      expect(text).not.toMatch(/at this home|verified|proven/i);
    }
  });
});

describe("SampleBuffer", () => {
  it("keeps readings in clock order and ignores repeats and junk", () => {
    const buffer = new SampleBuffer(3);
    expect(buffer.add({ t: 0, lat: 1, lng: 2, acc: 5 })).toBe(true);
    expect(buffer.add({ t: 0, lat: 1, lng: 2, acc: 5 })).toBe(false);
    expect(buffer.add({ t: -5, lat: 1, lng: 2, acc: 5 })).toBe(false);
    expect(buffer.add({ t: 500, lat: Number.NaN, lng: 2, acc: 5 })).toBe(false);
    expect(buffer.add({ t: 1000, lat: 1, lng: 2, acc: 5 })).toBe(true);
    expect(buffer.add({ t: 2000, lat: 1, lng: 2, acc: 5 })).toBe(true);
    expect(buffer.add({ t: 3000, lat: 1, lng: 2, acc: 5 })).toBe(false); // over the limit
    expect(buffer.size).toBe(3);
    expect(buffer.latest?.t).toBe(2000);
    expect(buffer.toArray()).toHaveLength(3);
  });
});

describe("bookendMeter", () => {
  it("disables Finish without a good start fix, with the visible reason", () => {
    const meter = bookendMeter(samples(10, 0, 8), 200_000, T);
    expect(meter.startMet).toBe(false);
    expect(meter.canFinish).toBe(false);
    expect(meter.reason).toBe(FINISH_REASON);
  });

  it("enables Finish once the start fix is good and enough time has passed indoors", () => {
    const early = bookendMeter(samples(20, 0, 8), 30_000, T);
    expect(early.startMet).toBe(true);
    expect(early.indoorMet).toBe(false);
    expect(early.canFinish).toBe(false);

    const later = bookendMeter(samples(20, 0, 8), (T.minIndoorSeconds + T.bookendWindowSeconds) * 1000, T);
    expect(later.canFinish).toBe(true);
    expect(later.reason).toBeNull();
  });

  it("the end window slides with the clock and only counts accurate fixes", () => {
    const start = samples(20, 0, 8);
    const rough = samples(50, 100_000, 90);
    const end = samples(20, 280_000, 8);
    const meter = bookendMeter([...start, ...rough, ...end], 300_000, T);
    expect(meter.endCount).toBe(20);
    expect(meter.endMet).toBe(true);

    const notYet = bookendMeter([...start, ...rough], 300_000, T);
    expect(notYet.endCount).toBe(0);
    expect(notYet.endMet).toBe(false);
    // Finish is still allowed: the server judges the end bookend, not the page.
    expect(notYet.canFinish).toBe(true);
  });

  it("has no notion of a verdict", () => {
    const meter = bookendMeter(samples(40, 0, 8), 300_000, T);
    expect(Object.keys(meter).sort()).toEqual(
      ["canFinish", "endCount", "endMet", "indoorMet", "reason", "startCount", "startMet"].sort(),
    );
  });
});

describe("formatElapsed and guidance", () => {
  it("formats mm:ss and never goes negative", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(61_500)).toBe("01:01");
    expect(formatElapsed(-4000)).toBe("00:00");
    expect(formatElapsed(3_599_999)).toBe("59:59");
  });

  it("rotates guidance every 20 s and wraps", () => {
    expect(guidanceAt(0)).toBe("Slow and steady.");
    expect(guidanceAt(20_000)).toBe("Turn fully at each doorway.");
    expect(guidanceAt(40_000)).toBe("Film every room you rent.");
    expect(guidanceAt(60_000)).toBe("Slow and steady.");
  });
});

describe("captureSupport", () => {
  it("names what is missing", () => {
    expect(captureSupport({}, true)).toEqual({ ok: false, missing: "camera" });
    expect(captureSupport({ mediaDevices: { getUserMedia: () => {} } }, true)).toEqual({ ok: false, missing: "location" });
    expect(captureSupport({ mediaDevices: { getUserMedia: () => {} }, geolocation: {} }, false)).toEqual({
      ok: false,
      missing: "recording",
    });
    expect(captureSupport({ mediaDevices: { getUserMedia: () => {} }, geolocation: {} }, true)).toEqual({ ok: true });
  });
});
