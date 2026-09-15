/**
 * HM-01 — the geofence verdict.
 *
 * Judges a walk's location record against the listing's confirmed front
 * door. Pure: no I/O, no clock, integer metres and seconds. HM-02 calls this
 * at upload completion and writes the result to the scan row; nothing in the
 * browser can produce a verdict.
 *
 * The rule (BUILD-PLAN §11, DECISIONS D07): indoor GPS is expected to be
 * poor, so the walk is judged on its outdoor bookends. Each of the first and
 * last `bookendWindowSeconds` must hold at least `bookendMinSamples`
 * accurate samples (accuracy radius ≤ `accuracyMaxM`), and the median of
 * each bookend's accurate samples must sit within `geofenceRadiusM` of the
 * target. A walk that never had an accurate fix, or whose accurate fixes
 * cluster somewhere else, fails closed. Nothing here ever invents a point.
 */
import type { ScanReason, ScanThresholds } from "../../src/lib/types";

/** One location reading. `t` is milliseconds on the recording clock. */
export type GeoSample = {
  t: number;
  lat: number;
  lng: number;
  /** Reported accuracy radius in metres. */
  acc: number;
};

export type GeoPoint = { lat: number; lng: number };

export type GeofenceStats = {
  sampleCount: number;
  accurateCount: number;
  durationSeconds: number;
  startAccurate: number;
  endAccurate: number;
  /** Integer metres from the target to the median of all accurate samples, or null. */
  medianDistanceM: number | null;
  startDistanceM: number | null;
  endDistanceM: number | null;
};

export type GeofenceVerdict =
  | { ok: true; stats: GeofenceStats }
  | { ok: false; reason: ScanReason; stats: GeofenceStats };

/** DECISIONS D07 defaults; app_config overrides them (0015 seeds the same values). */
export const DEFAULT_SCAN_THRESHOLDS: ScanThresholds = {
  accuracyMaxM: 35,
  geofenceRadiusM: 100,
  bookendWindowSeconds: 90,
  bookendMinSamples: 15,
  minIndoorSeconds: 60,
  maxSeconds: 600,
};

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance, rounded to whole metres. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_M * c);
}

export function isValidPoint(p: { lat: unknown; lng: unknown }): p is GeoPoint {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** Keep only well-formed readings. A malformed sample is dropped, never repaired. */
export function sanitizeSamples(input: unknown): GeoSample[] {
  if (!Array.isArray(input)) return [];
  const out: GeoSample[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const t = s.t;
    const acc = s.acc;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    if (typeof acc !== "number" || !Number.isFinite(acc) || acc < 0) continue;
    if (!isValidPoint({ lat: s.lat, lng: s.lng })) continue;
    out.push({ t, lat: s.lat as number, lng: s.lng as number, acc });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Component-wise median: robust to a few wild fixes, fine at house scale. */
function medianPoint(samples: GeoSample[]): GeoPoint | null {
  if (samples.length === 0) return null;
  return { lat: median(samples.map((s) => s.lat)), lng: median(samples.map((s) => s.lng)) };
}

export function judgeWalk(
  rawSamples: unknown,
  target: GeoPoint,
  thresholds: ScanThresholds = DEFAULT_SCAN_THRESHOLDS,
): GeofenceVerdict {
  const samples = sanitizeSamples(rawSamples);
  const accurate = samples.filter((s) => s.acc <= thresholds.accuracyMaxM);
  const first = samples[0]?.t ?? 0;
  const last = samples[samples.length - 1]?.t ?? 0;
  const durationSeconds = samples.length >= 2 ? Math.round((last - first) / 1000) : 0;
  const windowMs = thresholds.bookendWindowSeconds * 1000;
  const startWindow = accurate.filter((s) => s.t <= first + windowMs);
  const endWindow = accurate.filter((s) => s.t >= last - windowMs);

  const overall = medianPoint(accurate);
  const startPoint = medianPoint(startWindow);
  const endPoint = medianPoint(endWindow);
  const stats: GeofenceStats = {
    sampleCount: samples.length,
    accurateCount: accurate.length,
    durationSeconds,
    startAccurate: startWindow.length,
    endAccurate: endWindow.length,
    medianDistanceM: overall ? distanceMetres(overall, target) : null,
    startDistanceM: startPoint ? distanceMetres(startPoint, target) : null,
    endDistanceM: endPoint ? distanceMetres(endPoint, target) : null,
  };

  if (!isValidPoint(target)) return { ok: false, reason: "location_mismatch", stats };
  if (samples.length < 2 || durationSeconds < thresholds.minIndoorSeconds) {
    return { ok: false, reason: "walk_too_short", stats };
  }
  if (durationSeconds > thresholds.maxSeconds) {
    return { ok: false, reason: "walk_too_long", stats };
  }
  if (
    startWindow.length < thresholds.bookendMinSamples ||
    endWindow.length < thresholds.bookendMinSamples
  ) {
    return { ok: false, reason: "too_few_samples", stats };
  }
  // Both bookends must be at the door, and so must the walk as a whole.
  const radius = thresholds.geofenceRadiusM;
  if (
    stats.startDistanceM === null ||
    stats.endDistanceM === null ||
    stats.medianDistanceM === null ||
    stats.startDistanceM > radius ||
    stats.endDistanceM > radius ||
    stats.medianDistanceM > radius
  ) {
    return { ok: false, reason: "location_mismatch", stats };
  }
  return { ok: true, stats };
}

function intFrom(value: unknown, fallback: number, min: number): number {
  const n =
    typeof value === "number" && Number.isInteger(value)
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : fallback;
  return n >= min ? n : fallback;
}

/** Read D07 thresholds from an app_config map, falling back per key. */
export function scanThresholdsFromConfig(map: Record<string, unknown>): ScanThresholds {
  const d = DEFAULT_SCAN_THRESHOLDS;
  return {
    accuracyMaxM: intFrom(map.scan_accuracy_max_m, d.accuracyMaxM, 1),
    geofenceRadiusM: intFrom(map.scan_geofence_radius_m, d.geofenceRadiusM, 1),
    bookendWindowSeconds: intFrom(map.scan_bookend_window_seconds, d.bookendWindowSeconds, 1),
    bookendMinSamples: intFrom(map.scan_bookend_min_samples, d.bookendMinSamples, 1),
    minIndoorSeconds: intFrom(map.scan_min_indoor_seconds, d.minIndoorSeconds, 0),
    maxSeconds: intFrom(map.scan_max_seconds, d.maxSeconds, 1),
  };
}

export function policyVersionFromConfig(map: Record<string, unknown>): number {
  return intFrom(map.honesty_policy_version, 1, 1);
}
