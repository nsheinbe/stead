/**
 * Pure helpers for the capture client (HM-01). Nothing here decides a verdict:
 * the phone classifies a fix so the host knows whether to keep standing
 * still, and the server judges the whole record afterwards.
 */
import type { ScanLocationSample, ScanSamplePhase } from "./types";

/** What the location line says. Text first; the meter only reinforces it. */
export type FixQuality = "off" | "none" | "rough" | "good";

/**
 * The stages of a walk as the host experiences them. Samples are stamped with
 * the phase of the stage they arrived in (see `phaseForStage`).
 */
export type CaptureStage =
  | "permissions"
  | "outdoor_start"
  | "turn"
  | "indoor"
  | "outdoor_end"
  | "finishing"
  | "done";

/** A fix older than this is "no fix yet" again, whatever its accuracy said. */
export const FIX_STALE_MS = 15_000;

/**
 * The phase a sample gets from the stage it was taken in. Nothing is recorded
 * before location permission is granted, nor once the walk is being sent.
 */
export function phaseForStage(stage: CaptureStage): ScanSamplePhase | null {
  switch (stage) {
    case "outdoor_start":
    case "turn":
      return "outdoor_start";
    case "indoor":
      return "indoor";
    case "outdoor_end":
      return "outdoor_end";
    default:
      return null;
  }
}

export function classifyFix(
  latest: Pick<ScanLocationSample, "accuracyMeters" | "recordedAt"> | null,
  nowMs: number,
  accuracyMaxMeters: number,
  permission: "granted" | "denied" | "unknown" = "granted",
): FixQuality {
  if (permission === "denied") return "off";
  if (!latest) return "none";
  const age = nowMs - Date.parse(latest.recordedAt);
  if (!Number.isFinite(age) || age > FIX_STALE_MS) return "none";
  return latest.accuracyMeters <= accuracyMaxMeters ? "good" : "rough";
}

/**
 * Whether the host may start (or finish) at the door: the last
 * `bookendMinSamples` samples of that phase are all good and the newest is
 * fresh. This mirrors what the server will demand of the bookends, so the
 * button only lights up for a walk that can pass.
 */
export function bookendReady(
  samples: readonly ScanLocationSample[],
  phase: ScanSamplePhase,
  nowMs: number,
  accuracyMaxMeters: number,
  bookendMinSamples: number,
): boolean {
  const inPhase = samples.filter((s) => s.phase === phase);
  if (inPhase.length < bookendMinSamples) return false;
  const tail = inPhase.slice(-bookendMinSamples);
  if (!tail.every((s) => s.accuracyMeters <= accuracyMaxMeters)) return false;
  const newest = tail[tail.length - 1]!;
  return classifyFix(newest, nowMs, accuracyMaxMeters) === "good";
}

/** Shape of a browser GeolocationPosition, kept structural for tests. */
export type PositionLike = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
};

export function toSample(position: PositionLike, phase: ScanSamplePhase): ScanLocationSample {
  const accuracy = Number.isFinite(position.coords.accuracy)
    ? Math.max(0, Math.round(position.coords.accuracy))
    : 100_000;
  return {
    recordedAt: new Date(position.timestamp).toISOString(),
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyMeters: accuracy,
    phase,
  };
}

/** `mm:ss`, tabular. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Recorder types in order of preference. iOS Safari records MP4; Chrome, WebM. */
export const RECORDER_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | null {
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // A throwing isTypeSupported is a "no".
    }
  }
  return null;
}

/** Whether this browser can record in the page at all. */
export function hasCaptureSupport(nav: {
  mediaDevices?: { getUserMedia?: unknown };
  geolocation?: unknown;
}, hasRecorder: boolean): boolean {
  return Boolean(nav.mediaDevices?.getUserMedia) && Boolean(nav.geolocation) && hasRecorder;
}
