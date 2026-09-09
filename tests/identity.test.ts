/**
 * Slice 7 — Stripe Identity raises verification_tier to 2.
 * The webhook is what writes id_verified; members cannot.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { handleStripeEvent, type WebhookStore } from "../server/lib/stripeWebhook";
import {
  asMember,
  asOwner,
  closeTestDb,
  id,
  insertMember,
  ownerDatabaseUrl,
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function fakeStore(overrides: Partial<WebhookStore> = {}): WebhookStore {
  return {
    claimEvent: async () => true,
    confirmBookingByPaymentIntent: async () => false,
    findExpiredBooking: async () => null,
    recordDisputeOpened: async () => false,
    recordDisputeClosed: async () => false,
    markIdVerified: async () => false,
    ...overrides,
  };
}

describe("identity webhook router", () => {
  it("marks the metadata user verified on identity.verification_session.verified", async () => {
    const seen: string[] = [];
    const result = await handleStripeEvent(
      {
        id: "evt_vs",
        type: "identity.verification_session.verified",
        data: {
          object: {
            id: "vs_abc",
            metadata: { user_id: "11111111-1111-4111-8111-111111111111" },
            status: "verified",
          },
        },
      },
      fakeStore({
        markIdVerified: async (userId, sessionId) => {
          seen.push(`${userId}:${sessionId}`);
          return true;
        },
      }),
    );
    expect(result.identityVerified).toBe(true);
    expect(seen).toEqual(["11111111-1111-4111-8111-111111111111:vs_abc"]);
  });

  it("ignores a verified event with no user_id", async () => {
    let called = false;
    const result = await handleStripeEvent(
      {
        id: "evt_vs_empty",
        type: "identity.verification_session.verified",
        data: { object: { id: "vs_abc", metadata: {} } },
      },
      fakeStore({
        markIdVerified: async () => {
          called = true;
          return true;
        },
      }),
    );
    expect(result.identityVerified).toBe(false);
    expect(called).toBe(false);
  });
});

describeDb("verification_tier from Stripe Identity", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("raises trust_stats.verification_tier to 2 when id_verified is set", async () => {
    const memberId = id();
    await insertMember(memberId, `id-${memberId}@stead.example`, "Ida");

    const before = await asOwner(async (db) => {
      const rows = (await db.execute(
        sql`SELECT verification_tier FROM public.trust_stats WHERE profile_id = ${memberId}::uuid`,
      )) as unknown as { verification_tier: number }[];
      return Number(rows[0]?.verification_tier);
    });
    expect(before).toBe(0);

    const marked = await asMember(null, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT app.mark_id_verified(${memberId}::uuid, 'vs_test_abc') AS ok`,
      )) as unknown as { ok: boolean }[];
      return rows[0]?.ok;
    });
    expect(marked).toBe(true);

    const after = await asOwner(async (db) => {
      const rows = (await db.execute(sql`
        SELECT verification_tier, id_verified
          FROM public.trust_stats t
          JOIN public.profiles p ON p.id = t.profile_id
         WHERE t.profile_id = ${memberId}::uuid
      `)) as unknown as { verification_tier: number; id_verified: boolean }[];
      return rows[0];
    });
    expect(after?.id_verified).toBe(true);
    expect(Number(after?.verification_tier)).toBe(2);
  });

  it("refuses a member marking themselves verified", async () => {
    const memberId = id();
    await insertMember(memberId, `self-${memberId}@stead.example`, "Self");
    const ok = (await rawAsMember(
      memberId,
      (tx) => tx`SELECT app.mark_id_verified(${memberId}::uuid, 'vs_nope') AS ok`,
    )) as { ok: boolean }[];
    expect(ok[0]?.ok).toBe(false);

    const verified = await asOwner(async (db) => {
      const rows = (await db.execute(
        sql`SELECT id_verified FROM public.profiles WHERE id = ${memberId}::uuid`,
      )) as unknown as { id_verified: boolean }[];
      return rows[0]?.id_verified;
    });
    expect(verified).toBe(false);
  });

  it("keeps id_verified off the member UPDATE grant", async () => {
    const memberId = id();
    await insertMember(memberId, `grant-${memberId}@stead.example`, "Grant");
    await expect(
      rawAsMember(
        memberId,
        (tx) => tx`UPDATE public.profiles SET id_verified = true WHERE id = ${memberId}::uuid`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
