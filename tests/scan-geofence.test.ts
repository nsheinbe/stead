/**
 * HM-01 — the geofence verdict is the server's, and it fails closed.
 *
 * BUILD-PLAN HM-01 acceptance: a capture that never gets an accurate fix
 * cannot become verified; a capture whose samples cluster away from the
 * listing fails. Plus the bookend rule that makes indoor GPS survivable:
 * good fixes at the start and the end, at the door.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_THRESHOLDS,
  distanceMetres,
  judgeWalk,
  policyVersionFromConfig,
  sanitizeSamples,
  scanThresholdsFromConfig,
  type GeoSample,
} from "../server/lib/geofence";

// A front door in Hudson, NY. Distances are small enough that a metre of
// latitude is ~0.000009 degrees and of longitude ~0.000012 degrees here.
const DOOR = { lat: 42.2529, lng: -73.791 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((DOOR.lat * Math.PI) / 180));

function at(metresNorth: number, metresEast: number) {
  return { lat: DOOR.lat + metresNorth * M_LAT, lng: DOOR.lng + metresEast * M_LNG };
}

/** A realistic walk: outside first, indoors with poor accuracy, outside last. */
function walk(opts: {
  seconds?: number;
  outdoorAcc?: number;
  indoorAcc?: number;
  offsetM?: number;
  startSamples?: number;
  endSamples?: number;
  indoorEveryMs?: number;
} = {}): GeoSample[] {
  const seconds = opts.seconds ?? 300;
  const outdoorAcc = opts.outdoorAcc ?? 8;
  const indoorAcc = opts.indoorAcc ?? 60;
  const offset = opts.offsetM ?? 0;
  const startSamples = opts.startSamples ?? 30;
  const endSamples = opts.endSamples ?? 30;
  const every = opts.indoorEveryMs ?? 2000;
  const out: GeoSample[] = [];
  const total = seconds * 1000;
  for (let i = 0; i < startSamples; i += 1) {
    const p = at(offset + (i % 3), i % 2);
    out.push({ t: i * 1000, ...p, acc: outdoorAcc });
  }
  for (let t = startSamples * 1000 + 500; t < total - endSamples * 1000; t += every) {
    const p = at(offset + 10, 5);
    out.push({ t, ...p, acc: indoorAcc });
  }
  for (let i = 0; i < endSamples; i += 1) {
    const p = at(offset + (i % 3), -(i % 2));
    out.push({ t: total - (endSamples - i) * 1000, ...p, acc: outdoorAcc });
  }
  return out;
}

describe("distanceMetres", () => {
  it("is zero at the same point and whole metres elsewhere", () => {
    expect(distanceMetres(DOOR, DOOR)).toBe(0);
    const d = distanceMetres(DOOR, at(100, 0));
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(99);
    expect(d).toBeLessThanOrEqual(101);
  });

  it("is symmetric", () => {
    const a = at(0, 250);
    expect(distanceMetres(DOOR, a)).toBe(distanceMetres(a, DOOR));
  });
});

describe("sanitizeSamples", () => {
  it("drops malformed readings rather than repairing them", () => {
    const clean = sanitizeSamples([
      { t: 0, lat: DOOR.lat, lng: DOOR.lng, acc: 5 },
      { t: 1000, lat: 999, lng: DOOR.lng, acc: 5 },
      { t: 2000, lat: DOOR.lat, lng: DOOR.lng, acc: -1 },
      { t: "3000", lat: DOOR.lat, lng: DOOR.lng, acc: 5 },
      null,
      "nope",
      { t: 4000, lat: DOOR.lat, lng: DOOR.lng, acc: Number.NaN },
      { t: 500, lat: DOOR.lat, lng: DOOR.lng, acc: 5 },
    ]);
    expect(clean.map((s) => s.t)).toEqual([0, 500]);
  });

  it("returns nothing for a non-array", () => {
    expect(sanitizeSamples(undefined)).toEqual([]);
    expect(sanitizeSamples({ t: 0 })).toEqual([]);
  });
});

describe("judgeWalk", () => {
  it("passes a walk with good outdoor bookends at the door and rough indoor fixes", () => {
    const verdict = judgeWalk(walk(), DOOR);
    expect(verdict.ok).toBe(true);
    expect(verdict.stats.startAccurate).toBeGreaterThanOrEqual(DEFAULT_SCAN_THRESHOLDS.bookendMinSamples);
    expect(verdict.stats.endAccurate).toBeGreaterThanOrEqual(DEFAULT_SCAN_THRESHOLDS.bookendMinSamples);
    expect(verdict.stats.medianDistanceM).not.toBeNull();
    expect(verdict.stats.medianDistanceM as number).toBeLessThanOrEqual(DEFAULT_SCAN_THRESHOLDS.geofenceRadiusM);
  });

  it("fails closed when no fix was ever accurate (accuracy-fail)", () => {
    const verdict = judgeWalk(walk({ outdoorAcc: 80, indoorAcc: 120 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("too_few_samples");
    expect(verdict.stats.accurateCount).toBe(0);
  });

  it("fails when the start bookend is thin, even if the end is fine (too-few-samples)", () => {
    const verdict = judgeWalk(walk({ startSamples: 5 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("too_few_samples");
  });

  it("fails when the end bookend is thin", () => {
    const verdict = judgeWalk(walk({ endSamples: 3 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("too_few_samples");
  });

  it("fails when the accurate samples cluster away from the door (center-too-far)", () => {
    const verdict = judgeWalk(walk({ offsetM: 400 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("location_mismatch");
    expect(verdict.stats.startDistanceM as number).toBeGreaterThan(DEFAULT_SCAN_THRESHOLDS.geofenceRadiusM);
  });

  it("fails when only one bookend is at the door", () => {
    // Start at the door, walk 300 m away, finish there.
    const near = walk({ endSamples: 0 });
    const farEnd: GeoSample[] = [];
    const total = 300_000;
    for (let i = 0; i < 30; i += 1) {
      farEnd.push({ t: total - (30 - i) * 1000, ...at(300, 0), acc: 8 });
    }
    const verdict = judgeWalk([...near.filter((s) => s.t < total - 31_000), ...farEnd], DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("location_mismatch");
  });

  it("fails a walk shorter than the indoor minimum", () => {
    const verdict = judgeWalk(walk({ seconds: 40, startSamples: 15, endSamples: 15 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("walk_too_short");
  });

  it("fails a walk longer than the cap", () => {
    const verdict = judgeWalk(walk({ seconds: 700 }), DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("walk_too_long");
  });

  it("never invents a point: empty, one sample, or a bad target all fail", () => {
    expect(judgeWalk([], DOOR).ok).toBe(false);
    expect(judgeWalk([{ t: 0, ...DOOR, acc: 3 }], DOOR).ok).toBe(false);
    const bad = judgeWalk(walk(), { lat: 91, lng: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("location_mismatch");
  });

  it("a single perfect EXIF-like reading is not a walk", () => {
    // One reading at the door with 1 m accuracy: still too few samples.
    const verdict = judgeWalk([{ t: 0, ...DOOR, acc: 1 }, { t: 120_000, ...DOOR, acc: 1 }], DOOR);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("too_few_samples");
  });

  it("honours the thresholds it is given", () => {
    const lenient = { ...DEFAULT_SCAN_THRESHOLDS, accuracyMaxM: 200, bookendMinSamples: 2 };
    expect(judgeWalk(walk({ outdoorAcc: 80, indoorAcc: 120, startSamples: 3, endSamples: 3 }), DOOR, lenient).ok).toBe(true);
    // A walk five metres off the door passes the default radius and fails a
    // two-metre one: the radius is the rule, not a constant in the helper.
    const strict = { ...DEFAULT_SCAN_THRESHOLDS, geofenceRadiusM: 2 };
    expect(judgeWalk(walk({ offsetM: 5 }), DOOR).ok).toBe(true);
    expect(judgeWalk(walk({ offsetM: 5 }), DOOR, strict).ok).toBe(false);
  });
});

describe("config readers", () => {
  it("reads integers from app_config and falls back per key", () => {
    expect(scanThresholdsFromConfig({})).toEqual(DEFAULT_SCAN_THRESHOLDS);
    expect(
      scanThresholdsFromConfig({
        scan_accuracy_max_m: 20,
        scan_geofence_radius_m: "150",
        scan_bookend_min_samples: 0,
        scan_max_seconds: "nope",
      }),
    ).toEqual({ ...DEFAULT_SCAN_THRESHOLDS, accuracyMaxM: 20, geofenceRadiusM: 150 });
    expect(policyVersionFromConfig({})).toBe(1);
    expect(policyVersionFromConfig({ honesty_policy_version: "3" })).toBe(3);
    expect(policyVersionFromConfig({ honesty_policy_version: 0 })).toBe(1);
  });
});
