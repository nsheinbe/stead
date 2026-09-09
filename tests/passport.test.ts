/**
 * Slice 4 — Trust Passport: Ed25519 signature verifies; host_cancellations
 * is on the stats that the card renders.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  canonicalizePassport,
  generateTestSigningKey,
  signPassport,
  toCanonicalPassport,
  verifyPassport,
} from "../server/lib/passport";
import type { TrustStats } from "../src/lib/types";
import {
  asOwner,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function sampleStats(overrides: Partial<TrustStats> = {}): TrustStats {
  return {
    profileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    staysCompleted: 21,
    damageFreeStreak: 21,
    avgRatingAsGuest: 4.93,
    avgRatingAsHost: 4.88,
    reviewCount: 34,
    responseRate: null,
    hostCancellations: 2,
    verificationTier: 2,
    memberSince: "2023-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Trust Passport signature", () => {
  it("signs canonical JSON and verifies with the same key", () => {
    const key = generateTestSigningKey();
    const stats = sampleStats();
    const signed = signPassport(stats, key);

    expect(signed.alg).toBe("Ed25519");
    expect(signed.canonical).toBe(canonicalizePassport(signed.payload));
    expect(signed.payload.host_cancellations).toBe(2);
    expect(verifyPassport(signed.payload, signed.signature, key)).toBe(true);
  });

  it("fails verification if a field is tampered with", () => {
    const key = generateTestSigningKey();
    const signed = signPassport(sampleStats(), key);
    const tampered = { ...signed.payload, host_cancellations: 0 };
    expect(verifyPassport(tampered, signed.signature, key)).toBe(false);
  });

  it("puts host_cancellations on the canonical payload the card signs", () => {
    const payload = toCanonicalPassport(sampleStats({ hostCancellations: 3 }));
    expect(payload.host_cancellations).toBe(3);
    expect(canonicalizePassport(payload)).toContain('"host_cancellations":3');
  });
});

describeDb("trust_stats.host_cancellations", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("counts canceled_by_host on the host's listings and is readable on the passport view", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Nora", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Maya");
    await insertListing({ id: listingId, hostId, title: "Passport cottage" });
    await insertBooking({
      listingId,
      guestId,
      checkIn: "2028-04-01",
      checkOut: "2028-05-01",
      status: "canceled_by_host",
    });
    await insertBooking({
      listingId,
      guestId,
      checkIn: "2028-06-01",
      checkOut: "2028-07-01",
      status: "canceled_by_host",
    });
    await insertBooking({
      listingId,
      guestId,
      checkIn: "2028-08-01",
      checkOut: "2028-08-31",
      status: "completed",
    });

    const rows = (await rawAsMember(
      null,
      (tx) =>
        tx`SELECT host_cancellations, stays_completed FROM public.trust_stats WHERE profile_id = ${hostId}::uuid`,
    )) as { host_cancellations: number; stays_completed: number }[];

    expect(Number(rows[0]?.host_cancellations)).toBe(2);
    // Host stays_completed counts guest-side completed stays, not hosted ones.
    expect(Number(rows[0]?.stays_completed)).toBe(0);

    const guestStats = (await rawAsMember(
      null,
      (tx) =>
        tx`SELECT stays_completed, host_cancellations FROM public.trust_stats WHERE profile_id = ${guestId}::uuid`,
    )) as { stays_completed: number; host_cancellations: number }[];
    expect(Number(guestStats[0]?.stays_completed)).toBe(1);
    expect(Number(guestStats[0]?.host_cancellations)).toBe(0);
  });

  it("breaks the damage-free streak on a resolved_host claim", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId });

    const older = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-01-01",
      checkOut: "2027-01-31",
      status: "completed",
    });
    const newer = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-03-01",
      checkOut: "2027-03-31",
      status: "completed",
    });

    await asOwner(async (db) => {
      await db.execute(sql`
        INSERT INTO public.claims (booking_id, filed_by, amount_cents, description, state)
        VALUES (${newer}::uuid, ${hostId}::uuid, 1000, 'Streak break', 'resolved_host')
      `);
      void older;
    });

    const rows = (await rawAsMember(
      null,
      (tx) => tx`SELECT damage_free_streak FROM public.trust_stats WHERE profile_id = ${guestId}::uuid`,
    )) as { damage_free_streak: number }[];
    expect(Number(rows[0]?.damage_free_streak)).toBe(0);
  });
});
