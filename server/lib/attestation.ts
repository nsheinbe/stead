/**
 * HM-02 — the location record as the server reads it.
 *
 * The phone uploads samples and clocks. This parser keeps exactly those and
 * drops everything else, so a client that adds "verified": true or a fence
 * result of its own changes nothing: the verdict comes from judgeWalk over
 * the samples, against the scan row's frozen target and thresholds.
 */
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import type { ScanAttestation } from "../../src/lib/types";

const sample = z.object({
  t: z.number().finite().nonnegative(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  acc: z.number().finite().nonnegative(),
});

const pause = z.object({
  fromMs: z.number().finite().nonnegative(),
  toMs: z.number().finite().nonnegative(),
});

export const attestationSchema = z
  .object({
    version: z.literal(1),
    scanId: z.string().uuid(),
    listingId: z.string().uuid(),
    policyVersion: z.number().int().positive(),
    recording: z
      .object({
        startedAt: z.string().datetime({ offset: true }),
        durationMs: z.number().finite().nonnegative(),
        mimeType: z.string().min(1).max(100),
      })
      .strip(),
    samples: z.array(sample).max(20_000),
    pauses: z.array(pause).max(1_000).default([]),
    client: z
      .object({
        userAgent: z.string().max(500).default(""),
        platform: z.string().max(100).nullable().default(null),
      })
      .strip()
      .default({ userAgent: "", platform: null }),
  })
  // Unknown keys are dropped, not stored: no client-owned verdict survives.
  .strip();

export type ParsedAttestation = ScanAttestation;

export type AttestationResult =
  | { ok: true; attestation: ParsedAttestation }
  | { ok: false; problem: string };

export function parseAttestation(text: string): AttestationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, problem: "not JSON" };
  }
  const parsed = attestationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problem: parsed.error.issues[0]?.message ?? "invalid" };
  }
  return { ok: true, attestation: parsed.data as ParsedAttestation };
}

/** The listing-local calendar date the walk started, for "Captured {date}". */
export function capturedOnFor(startedAt: string, timezone: string): string {
  return formatInTimeZone(new Date(startedAt), timezone, "yyyy-MM-dd");
}
