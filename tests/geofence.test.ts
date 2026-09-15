/**
 * HM-01. The geofence gate, reason by reason.
 *
 * Every verdict here is produced from a synthetic walk around one pin, so a
 * change to any rule in server/lib/geofence.ts shows up as a named failure
 * rather than a host being refused in the field.
 */
import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  judgeWalk,
  type GeofenceThresholds,
  type GeoPhase,
  type GeoSample,
} from "../server/lib/geofence";

const PIN = { lat: 40.7128, lng: -74.006 };
const T: GeofenceThresholds = {
  accuracyMaxMeters: 25,
  geofenceRadiusMeters: 60,
  indoorToleranceMeters: 500,
  minSamples: 20,
  bookendMinSamples: 3,
  maxGapSeconds: 45,
};

/** Degrees of latitude per metre at this scale. Longitude is scaled by cos(lat). */
const DEG_PER_M_LAT = 1 / 111_320;
const DEG_PER_M_LNG = 1 / (111_320 * Math.cos((PIN.lat * Math.PI) / 180));

function offset(meters: number, bearingEast = false) {
  return bearingEast
    ? { lat: PIN.lat, lng: PIN.lng + meters * DEG_PER_M_LNG }
    : { lat: PIN.lat + meters * DEG_PER_M_LAT, lng: PIN.lng };
}

type Leg = { phase: GeoPhase; count: number; accuracy: number; away?: number; stepSeconds?: number };

/** A walk built from legs, one sample per `stepSeconds`, starting at t0. */
function walk(legs: Leg[], t0 = Date.parse("2026-09-15T14:00:00Z")): GeoSample[] {
  const out: GeoSample[] = [];
  let t = t0;
  for (const leg of legs) {
    for (let i = 0; i < leg.count; i += 1) {
      const pos = offset(leg.away ?? 0);
      out.push({
        recordedAt: new Date(t).toISOString(),
        lat: pos.lat,
        lng: pos.lng,
        accuracyMeters: leg.accuracy,
        phase: leg.phase,
      });
      t += (leg.stepSeconds ?? 1) * 1000;
    }
  }
  return out;
}

const GOOD_WALK: Leg[] = [
  { phase: "outdoor_start", count: 5, accuracy: 8, away: 4 },
  { phase: "indoor", count: 40, accuracy: 80, away: 20 },
  { phase: "outdoor_end", count: 5, accuracy: 10, away: 6 },
];

describe("distanceMeters", () => {
  it("is zero for the same point and about 111 km per degree of latitude", () => {
    expect(distanceMeters(PIN, PIN)).toBe(0);
    expect(distanceMeters(PIN, { lat: PIN.lat + 1, lng: PIN.lng })).toBeGreaterThan(111_000);
    expect(distanceMeters(PIN, { lat: PIN.lat + 1, lng: PIN.lng })).toBeLessThan(111_500);
  });

  it("rounds to whole metres and is symmetric", () => {
    const a = offset(37.4);
    expect(Number.isInteger(distanceMeters(PIN, a))).toBe(true);
    expect(distanceMeters(PIN, a)).toBe(distanceMeters(a, PIN));
    expect(distanceMeters(PIN, a)).toBe(37);
  });
});

describe("judgeWalk", () => {
  it("passes a walk that starts and ends at the door with a rough middle", () => {
    const verdict = judgeWalk(PIN, walk(GOOD_WALK), T);
    expect(verdict.passed).toBe(true);
    if (!verdict.passed) return;
    expect(verdict.sampleCount).toBe(50);
    expect(verdict.maxDistanceMeters).toBe(20);
    expect(verdict.startedAt).toBe("2026-09-15T14:00:00.000Z");
    expect(verdict.finishedAt).toBe("2026-09-15T14:00:49.000Z");
  });

  it("refuses too few samples", () => {
    const verdict = judgeWalk(PIN, walk(GOOD_WALK).slice(0, 19), T);
    expect(verdict).toMatchObject({ passed: false, reason: "samples", sampleCount: 19 });
  });

  it("refuses a record that goes quiet longer than the gap allows", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8 },
      { phase: "indoor", count: 20, accuracy: 60, stepSeconds: 1 },
      // One reading 46 s after the previous.
      { phase: "indoor", count: 1, accuracy: 60, stepSeconds: 46 },
      { phase: "indoor", count: 20, accuracy: 60 },
      { phase: "outdoor_end", count: 5, accuracy: 8 },
    ];
    const samples = walk(legs);
    // Shift everything after the 25th sample by 45 s so the gap is 46 s.
    const shifted = samples.map((s, i) =>
      i >= 26 ? { ...s, recordedAt: new Date(Date.parse(s.recordedAt) + 45_000).toISOString() } : s,
    );
    expect(judgeWalk(PIN, shifted, T)).toMatchObject({ passed: false, reason: "samples" });
  });

  it("does not care what order the samples arrive in", () => {
    const shuffled = [...walk(GOOD_WALK)].reverse();
    expect(judgeWalk(PIN, shuffled, T).passed).toBe(true);
  });

  it("refuses a walk without an outdoor end", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8 },
      { phase: "indoor", count: 40, accuracy: 80 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "bookends" });
  });

  it("refuses a walk without an outdoor start", () => {
    const legs: Leg[] = [
      { phase: "indoor", count: 40, accuracy: 80 },
      { phase: "outdoor_end", count: 5, accuracy: 8 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "bookends" });
  });

  it("refuses phases that run backwards", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8 },
      { phase: "indoor", count: 20, accuracy: 80 },
      { phase: "outdoor_end", count: 5, accuracy: 8 },
      // Back indoors after the end bookend.
      { phase: "indoor", count: 20, accuracy: 80 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "bookends" });
  });

  it("refuses a walk with no indoor part at all", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 15, accuracy: 8 },
      { phase: "outdoor_end", count: 15, accuracy: 8 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "samples" });
  });

  it("refuses bookends that never got a good fix", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 40 },
      { phase: "indoor", count: 40, accuracy: 80 },
      { phase: "outdoor_end", count: 5, accuracy: 10 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "accuracy" });
  });

  it("needs the configured number of good samples at each bookend, not one", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 2, accuracy: 8 },
      { phase: "outdoor_start", count: 3, accuracy: 60 },
      { phase: "indoor", count: 40, accuracy: 80 },
      { phase: "outdoor_end", count: 5, accuracy: 10 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "accuracy" });
  });

  it("refuses a walk whose samples cluster away from the pin", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8, away: 2_000 },
      { phase: "indoor", count: 40, accuracy: 80, away: 2_000 },
      { phase: "outdoor_end", count: 5, accuracy: 10, away: 2_000 },
    ];
    const verdict = judgeWalk(PIN, walk(legs), T);
    expect(verdict).toMatchObject({ passed: false, reason: "geofence" });
    if (verdict.passed) return;
    // The flat offset is approximate; the point is that it is far, not exact.
    expect(verdict.maxDistanceMeters).toBeGreaterThan(1_900);
  });

  it("refuses accurate bookends that are not at the door, even with a rough middle nearby", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8, away: 120 },
      { phase: "indoor", count: 40, accuracy: 80, away: 20 },
      { phase: "outdoor_end", count: 5, accuracy: 10, away: 6 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "geofence" });
  });

  it("lets a rough indoor fix wander as far as its accuracy honestly admits", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8, away: 4 },
      // 400 m away with a 450 m radius: consistent with being at the pin.
      { phase: "indoor", count: 40, accuracy: 450, away: 400 },
      { phase: "outdoor_end", count: 5, accuracy: 10, away: 6 },
    ];
    expect(judgeWalk(PIN, walk(legs), T).passed).toBe(true);
  });

  it("caps how much an absurd accuracy can excuse", () => {
    const legs: Leg[] = [
      { phase: "outdoor_start", count: 5, accuracy: 8, away: 4 },
      // 2 km away claiming a 5 km radius: capped at 500 m of tolerance.
      { phase: "indoor", count: 40, accuracy: 5_000, away: 2_000 },
      { phase: "outdoor_end", count: 5, accuracy: 10, away: 6 },
    ];
    expect(judgeWalk(PIN, walk(legs), T)).toMatchObject({ passed: false, reason: "geofence" });
  });

  it("refuses a sample whose timestamp cannot be read", () => {
    const samples = walk(GOOD_WALK);
    samples[10] = { ...samples[10]!, recordedAt: "yesterday" };
    expect(judgeWalk(PIN, samples, T)).toMatchObject({ passed: false, reason: "samples" });
  });

  it("does not read EXIF, IP or anything but the samples it was given", () => {
    // A single sample carrying extra fields changes nothing: only the five
    // declared fields participate. This guards the "EXIF alone is not proof" rule
    // at the type boundary.
    const samples = walk(GOOD_WALK).map((s) => ({ ...s, exifLat: 0, exifLng: 0 }));
    expect(judgeWalk(PIN, samples as GeoSample[], T).passed).toBe(true);
  });
});
