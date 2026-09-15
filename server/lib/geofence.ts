/**
 * The geofence gate for an honesty scan (HM-01).
 *
 * A walk is judged against the listing's front door pin from a continuous
 * location record the phone reported while recording. The rules are plain and
 * the thresholds are integers, snapshotted onto the scan when it started:
 *
 *   1. Enough samples, close together in time. Fewer than `minSamples`, or a
 *      gap wider than `maxGapSeconds`, and nothing can be said about the walk.
 *   2. Outdoor bookends. The record must start with `outdoor_start` samples,
 *      then `indoor`, then `outdoor_end`, in that order, and each bookend
 *      needs `bookendMinSamples` samples with accuracy no worse than
 *      `accuracyMaxMeters`. Indoor GPS is expected to be rough and is not
 *      held to that bar — the bookends are what anchor the walk to the door.
 *   3. Every sample is within reach of the pin: its distance may not exceed
 *      `geofenceRadiusMeters` plus its own reported accuracy, with that
 *      accuracy capped at `indoorToleranceMeters` so an absurd accuracy value
 *      cannot excuse an absurd distance. Good bookend samples are therefore
 *      tight (radius + at most `accuracyMaxMeters`); rough indoor samples are
 *      allowed to wander as far as their accuracy honestly admits.
 *
 * What this is: a strong provenance signal that the phone was at this pin
 * when the walk began and ended, and never reported being far away in
 * between. What this is not: courtroom GPS. A recording made within the
 * indoor tolerance of the pin would pass this gate; the outdoor approach
 * footage and the honesty disclosure carry the rest.
 *
 * Nothing here trusts a verdict from the client. The samples are the input;
 * the verdict is the output; the route stores both through
 * app.record_scan_location.
 */

export type GeoPhase = "outdoor_start" | "indoor" | "outdoor_end";

export type GeoSample = {
  /** ISO timestamp from the phone's clock. */
  recordedAt: string;
  lat: number;
  lng: number;
  /** Reported 68% accuracy radius, whole meters. */
  accuracyMeters: number;
  phase: GeoPhase;
};

export type GeofenceThresholds = {
  accuracyMaxMeters: number;
  geofenceRadiusMeters: number;
  indoorToleranceMeters: number;
  minSamples: number;
  bookendMinSamples: number;
  maxGapSeconds: number;
};

export type GeofenceRejectReason = "samples" | "accuracy" | "bookends" | "geofence";

export type GeofenceVerdict =
  | {
      passed: true;
      sampleCount: number;
      maxDistanceMeters: number;
      startedAt: string;
      finishedAt: string;
    }
  | {
      passed: false;
      reason: GeofenceRejectReason;
      sampleCount: number;
      maxDistanceMeters: number | null;
      startedAt: string | null;
      finishedAt: string | null;
    };

export type LatLng = { lat: number; lng: number };

/** Mean Earth radius, metres (IUGG). Fine at the scale of a front door. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const PHASE_RANK: Record<GeoPhase, number> = { outdoor_start: 0, indoor: 1, outdoor_end: 2 };

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance, rounded to whole metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_METERS * c);
}

function fail(
  reason: GeofenceRejectReason,
  sampleCount: number,
  extra: { maxDistanceMeters?: number | null; startedAt?: string | null; finishedAt?: string | null } = {},
): GeofenceVerdict {
  return {
    passed: false,
    reason,
    sampleCount,
    maxDistanceMeters: extra.maxDistanceMeters ?? null,
    startedAt: extra.startedAt ?? null,
    finishedAt: extra.finishedAt ?? null,
  };
}

/**
 * Judge a walk. Pure: the same samples and thresholds always give the same
 * verdict, which is what lets tests pin every reason down.
 */
export function judgeWalk(
  pin: LatLng,
  samples: readonly GeoSample[],
  thresholds: GeofenceThresholds,
): GeofenceVerdict {
  const sampleCount = samples.length;
  if (sampleCount < thresholds.minSamples) {
    return fail("samples", sampleCount);
  }

  const timed = samples.map((sample) => ({ sample, at: Date.parse(sample.recordedAt) }));
  if (timed.some((entry) => !Number.isFinite(entry.at))) {
    return fail("samples", sampleCount);
  }
  timed.sort((a, b) => a.at - b.at);
  const startedAt = timed[0]!.sample.recordedAt;
  const finishedAt = timed[timed.length - 1]!.sample.recordedAt;

  // Continuity: the record must not go quiet. A gap is where a splice would be.
  for (let i = 1; i < timed.length; i += 1) {
    if ((timed[i]!.at - timed[i - 1]!.at) / 1000 > thresholds.maxGapSeconds) {
      return fail("samples", sampleCount, { startedAt, finishedAt });
    }
  }

  // Phases run outdoor_start → indoor → outdoor_end and never back.
  let lastRank = -1;
  for (const { sample } of timed) {
    const rank = PHASE_RANK[sample.phase];
    if (rank < lastRank) {
      return fail("bookends", sampleCount, { startedAt, finishedAt });
    }
    lastRank = rank;
  }

  const starts = timed.filter((entry) => entry.sample.phase === "outdoor_start");
  const indoors = timed.filter((entry) => entry.sample.phase === "indoor");
  const ends = timed.filter((entry) => entry.sample.phase === "outdoor_end");
  if (starts.length === 0 || ends.length === 0) {
    return fail("bookends", sampleCount, { startedAt, finishedAt });
  }
  if (indoors.length === 0) {
    return fail("samples", sampleCount, { startedAt, finishedAt });
  }

  const good = (entries: typeof timed) =>
    entries.filter((entry) => entry.sample.accuracyMeters <= thresholds.accuracyMaxMeters).length;
  if (good(starts) < thresholds.bookendMinSamples || good(ends) < thresholds.bookendMinSamples) {
    return fail("accuracy", sampleCount, { startedAt, finishedAt });
  }

  // Reach: within the radius plus what the fix honestly admits it might be off by.
  let maxDistanceMeters = 0;
  for (const { sample } of timed) {
    const distance = distanceMeters(pin, sample);
    if (distance > maxDistanceMeters) maxDistanceMeters = distance;
    const tolerance =
      thresholds.geofenceRadiusMeters +
      Math.min(Math.max(0, sample.accuracyMeters), thresholds.indoorToleranceMeters);
    if (distance > tolerance) {
      return fail("geofence", sampleCount, { maxDistanceMeters, startedAt, finishedAt });
    }
  }

  return { passed: true, sampleCount, maxDistanceMeters, startedAt, finishedAt };
}
