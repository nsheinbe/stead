/**
 * HM-01 — the capture page's logic, kept out of React so it can be tested.
 *
 * What the browser may decide: which readout to show, whether the on-device
 * meter thinks the start bookend is met, and whether "Finish the walk" is
 * enabled. What it may never decide: the verdict. The server judges the
 * uploaded samples against its own copy of the thresholds (HM-02); nothing
 * here writes "at this home", "verified" or a pass flag anywhere.
 */
import { LOCATION_READOUT } from "./honestyCopy";
import type { ScanThresholds } from "./types";

/** A reading as the page records it. `t` is ms since the recording started. */
export type CaptureSample = { t: number; lat: number; lng: number; acc: number };

export type LocationPermission = "prompt" | "granted" | "denied";

export function readoutFor(
  latest: { acc: number } | null,
  permission: LocationPermission,
  thresholds: ScanThresholds,
): string {
  if (permission === "denied") return LOCATION_READOUT.off;
  if (!latest) return LOCATION_READOUT.waiting;
  return latest.acc <= thresholds.accuracyMaxM
    ? LOCATION_READOUT.good(latest.acc)
    : LOCATION_READOUT.rough(latest.acc);
}

/** Bounded buffer of readings on the recording clock; a repeat timestamp is ignored. */
export class SampleBuffer {
  private readonly samples: CaptureSample[] = [];

  constructor(private readonly limit = 20_000) {}

  add(sample: CaptureSample): boolean {
    if (!Number.isFinite(sample.t) || sample.t < 0) return false;
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng) || !Number.isFinite(sample.acc)) return false;
    const last = this.samples[this.samples.length - 1];
    if (last && sample.t <= last.t) return false;
    if (this.samples.length >= this.limit) return false;
    this.samples.push({ ...sample });
    return true;
  }

  get size(): number {
    return this.samples.length;
  }

  get latest(): CaptureSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }

  toArray(): CaptureSample[] {
    return [...this.samples];
  }
}

export type BookendMeter = {
  /** Accurate readings inside the first bookend window. */
  startCount: number;
  /** Accurate readings inside the trailing window ending now. */
  endCount: number;
  startMet: boolean;
  endMet: boolean;
  indoorMet: boolean;
  /** Whether Finish the walk may be enabled. Never a verdict. */
  canFinish: boolean;
  /** Visible reason beside a disabled Finish, or null. */
  reason: string | null;
};

export const FINISH_REASON = "We need a clear location fix outside the door at the start and the end.";

/**
 * The on-device meter. `elapsedMs` is the recording clock now. The end
 * window slides with the clock so the host sees "not yet" until they are
 * back outside with a good fix.
 */
export function bookendMeter(
  samples: readonly CaptureSample[],
  elapsedMs: number,
  thresholds: ScanThresholds,
): BookendMeter {
  const windowMs = thresholds.bookendWindowSeconds * 1000;
  const accurate = samples.filter((s) => s.acc <= thresholds.accuracyMaxM);
  const startCount = accurate.filter((s) => s.t <= windowMs).length;
  const endCount = accurate.filter((s) => s.t >= elapsedMs - windowMs).length;
  const startMet = startCount >= thresholds.bookendMinSamples;
  const endMet = endCount >= thresholds.bookendMinSamples;
  const indoorMet = elapsedMs >= (thresholds.minIndoorSeconds + thresholds.bookendWindowSeconds) * 1000;
  const canFinish = startMet && indoorMet;
  return {
    startCount,
    endCount,
    startMet,
    endMet,
    indoorMet,
    canFinish,
    reason: canFinish ? null : FINISH_REASON,
  };
}

/** mm:ss with tabular digits in mind. Never negative, never fractional. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const GUIDANCE_LINES = [
  "Slow and steady.",
  "Turn fully at each doorway.",
  "Film every room you rent.",
] as const;

/** Rotates guidance every `everyMs`; total so it never runs off the end. */
export function guidanceAt(elapsedMs: number, everyMs = 20_000): string {
  const index = Math.floor(Math.max(0, elapsedMs) / everyMs) % GUIDANCE_LINES.length;
  return GUIDANCE_LINES[index] ?? GUIDANCE_LINES[0];
}

/** Whether the capture page can run at all on this device. */
export function captureSupport(nav: {
  mediaDevices?: { getUserMedia?: unknown };
  geolocation?: unknown;
}, hasMediaRecorder: boolean): { ok: true } | { ok: false; missing: string } {
  if (!nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== "function") {
    return { ok: false, missing: "camera" };
  }
  if (!nav.geolocation) return { ok: false, missing: "location" };
  if (!hasMediaRecorder) return { ok: false, missing: "recording" };
  return { ok: true };
}
