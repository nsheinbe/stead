/**
 * Trust Passport signing. Canonical JSON of trust_stats, Ed25519 via
 * PASSPORT_SIGNING_KEY (PKCS8 PEM, then base64 — see .env.example).
 *
 * The public half is derived from the same key. Verify is a public endpoint;
 * anyone holding an export can check it without talking to us.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { TrustStats } from "../../src/lib/types";

export class PassportKeyError extends Error {
  constructor(message = "PASSPORT_SIGNING_KEY is not set") {
    super(message);
    this.name = "PassportKeyError";
  }
}

const CANONICAL_KEYS = [
  "avg_rating_as_guest",
  "avg_rating_as_host",
  "damage_free_streak",
  "host_cancellations",
  "member_since",
  "profile_id",
  "response_rate",
  "review_count",
  "stays_completed",
  "verification_tier",
] as const;

export type CanonicalPassport = {
  avg_rating_as_guest: number | null;
  avg_rating_as_host: number | null;
  damage_free_streak: number;
  host_cancellations: number;
  member_since: string;
  profile_id: string;
  response_rate: number | null;
  review_count: number;
  stays_completed: number;
  verification_tier: number;
};

function roundRating(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

export function toCanonicalPassport(stats: TrustStats): CanonicalPassport {
  return {
    avg_rating_as_guest: roundRating(stats.avgRatingAsGuest),
    avg_rating_as_host: roundRating(stats.avgRatingAsHost),
    damage_free_streak: stats.damageFreeStreak,
    host_cancellations: stats.hostCancellations,
    member_since: stats.memberSince,
    profile_id: stats.profileId,
    response_rate: roundRating(stats.responseRate),
    review_count: stats.reviewCount,
    stays_completed: stats.staysCompleted,
    verification_tier: stats.verificationTier,
  };
}

/** Sorted keys, no whitespace. The byte string that is signed. */
export function canonicalizePassport(payload: CanonicalPassport): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_KEYS) {
    ordered[key] = payload[key];
  }
  return JSON.stringify(ordered);
}

function pemFromEnv(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("PRIVATE KEY")) return trimmed;
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded.includes("PRIVATE KEY")) {
    throw new PassportKeyError("PASSPORT_SIGNING_KEY is not an Ed25519 PKCS8 key");
  }
  return decoded;
}

export function loadSigningKey(raw = process.env.PASSPORT_SIGNING_KEY): KeyObject {
  if (!raw?.trim()) throw new PassportKeyError();
  return createPrivateKey(pemFromEnv(raw));
}

export function signPassport(stats: TrustStats, rawKey = process.env.PASSPORT_SIGNING_KEY): {
  payload: CanonicalPassport;
  canonical: string;
  signature: string;
  alg: "Ed25519";
} {
  const key = loadSigningKey(rawKey);
  const payload = toCanonicalPassport(stats);
  const canonical = canonicalizePassport(payload);
  const signature = sign(null, Buffer.from(canonical, "utf8"), key).toString("base64");
  return { payload, canonical, signature, alg: "Ed25519" };
}

export function verifyPassport(
  payload: CanonicalPassport,
  signatureB64: string,
  rawKey = process.env.PASSPORT_SIGNING_KEY,
): boolean {
  const privateKey = loadSigningKey(rawKey);
  const publicKey = createPublicKey(privateKey);
  try {
    const signature = Buffer.from(signatureB64, "base64");
    if (signature.length === 0) return false;
    return verify(null, Buffer.from(canonicalizePassport(payload), "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

/** Ephemeral key for tests. Not used in production. */
export function generateTestSigningKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  return Buffer.from(typeof pem === "string" ? pem : pem.toString("utf8")).toString("base64");
}
