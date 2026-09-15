/**
 * HM-04 — the host's marks on the walk, as arithmetic.
 *
 * A mask is a list of half-open millisecond ranges on the recording clock.
 * Everything here is pure so the page and the server agree without talking:
 * the browser shows what will be cut, the server writes the same normalised
 * ranges, and the worker drops exactly those frames.
 *
 * Normalising is not cosmetic. Overlapping ranges would double-count in the
 * "everything is private" check, and an unsorted list would make two equal
 * masks compare unequal.
 */
import type { MaskSegment } from "./types";

/** More marks than a host could reasonably make on one walk; a bound, not a rule. */
export const MAX_MASK_SEGMENTS = 50;

/** Below this a mark cannot cover a frame, so it is a mis-tap, not an intent. */
export const MIN_SEGMENT_MS = 250;

function round(n: number): number {
  return Math.round(n);
}

/**
 * Clamp to the recording, drop what cannot hold a frame, sort, and merge
 * anything that touches. The result is disjoint and ascending.
 */
export function mergeSegments(segments: readonly MaskSegment[], durationMs: number): MaskSegment[] {
  const limit = Number.isFinite(durationMs) && durationMs > 0 ? round(durationMs) : 0;
  const clean = segments
    .map((s) => ({
      fromMs: Math.max(0, Math.min(round(s.fromMs), limit)),
      toMs: Math.max(0, Math.min(round(s.toMs), limit)),
    }))
    .filter((s) => s.toMs - s.fromMs >= MIN_SEGMENT_MS)
    .sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);

  const merged: MaskSegment[] = [];
  for (const segment of clean) {
    const last = merged[merged.length - 1];
    if (last && segment.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, segment.toMs);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/** Total time the host has marked private. Assumes merged input. */
export function totalMaskedMs(segments: readonly MaskSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.toMs - s.fromMs), 0);
}

/**
 * True when the marks leave nothing for a guest to walk through. Refused:
 * a walkthrough of nothing is not a walkthrough.
 */
export function coversWholeWalk(segments: readonly MaskSegment[], durationMs: number): boolean {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
  return totalMaskedMs(segments) >= round(durationMs);
}

/** Whether a frame at this moment survives the mask. The worker's rule, exactly. */
export function isMasked(segments: readonly MaskSegment[], atMs: number): boolean {
  return segments.some((s) => atMs >= s.fromMs && atMs < s.toMs);
}

export type MaskAnswer =
  | { kind: "none" }
  | { kind: "whole_home" }
  | { kind: "segments"; segments: MaskSegment[] };

/** What the host has answered so far, from the stored row. */
export function answerOf(mask: { wholeHomeConfirmedAt: string | null; segments: MaskSegment[] } | null): MaskAnswer {
  if (!mask) return { kind: "none" };
  if (mask.wholeHomeConfirmedAt) return { kind: "whole_home" };
  if (mask.segments.length > 0) return { kind: "segments", segments: mask.segments };
  return { kind: "none" };
}

/** mm:ss on the recording clock. Shared by the segment rows and the scrubber. */
export function formatMoment(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function formatRange(segment: MaskSegment): string {
  return `${formatMoment(segment.fromMs)} – ${formatMoment(segment.toMs)}`;
}

/**
 * Where each still sits on the recording clock. The worker picks stills
 * evenly spaced across the extracted frames, so still i of n is at
 * i/(n-1) of the walk — the first frame and the last, with the rest between.
 */
export function stillAtMs(index: number, count: number, durationMs: number): number {
  if (count <= 1 || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round((index / (count - 1)) * durationMs);
}

/** The still nearest a moment, for the scrubber's current frame. */
export function stillIndexAt(atMs: number, count: number, durationMs: number): number {
  if (count <= 0) return 0;
  if (count === 1 || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const exact = (atMs / durationMs) * (count - 1);
  return Math.max(0, Math.min(count - 1, Math.round(exact)));
}
