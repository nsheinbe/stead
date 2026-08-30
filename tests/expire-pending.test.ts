import { afterAll, describe, expect, it } from "vitest";
import { isPendingExpired } from "../supabase/functions/_shared/expirePending";
import { handleStripeEvent } from "../supabase/functions/_shared/stripeWebhook";
import {
  closeTestPool,
  databaseUrl,
  getTestPool,
  insertListing,
  insertUser,
} from "./helpers/db";

describe("isPendingExpired", () => {
  it("expires a hold at the ttl boundary", () => {
    const created = new Date("2026-08-30T12:00:00Z");
    expect(isPendingExpired(created, new Date("2026-08-30T12:29:59Z"), 30)).toBe(false);
    expect(isPendingExpired(created, new Date("2026-08-30T12:30:00Z"), 30)).toBe(true);
  });
});

describe("stripe webhook handler", () => {
  it("is idempotent: the second delivery of the same event is skipped", async () => {
    const seen = new Set<string>();
    const confirmed: string[] = [];
    const store = {
      claimEvent: async (id: string) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      },
      confirmBookingByPaymentIntent: async (pi: string) => {
        confirmed.push(pi);
        return true;
      },
    };

    const event = {
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_abc" } },
    };

    const first = await handleStripeEvent(event, store);
    const second = await handleStripeEvent(event, store);
    expect(first).toEqual({ skipped: false, confirmed: true });
    expect(second).toEqual({ skipped: true, confirmed: false });
    expect(confirmed).toEqual(["pi_abc"]);
  });
});

const describeDb = databaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("expire_pending_bookings()", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("expires pending_payment rows older than the configured ttl and leaves fresh ones", async () => {
    const pool = await getTestPool();
    const hostId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001";
    const guestId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001";
    const listingId = "cccccccc-cccc-cccc-cccc-cccccccc0001";
    const staleId = "dddddddd-dddd-dddd-dddd-dddddddd0001";
    const freshId = "dddddddd-dddd-dddd-dddd-dddddddd0002";

    await insertUser(pool, hostId, "host-expire@stead.example", "Host", true);
    await insertUser(pool, guestId, "guest-expire@stead.example", "Guest");
    await insertListing(pool, { id: listingId, hostId, title: "Expire cottage" });

    await pool.query(
      `INSERT INTO public.bookings (
         id, listing_id, guest_id, check_in, check_out, guests, nights,
         nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
         deposit_cents, cancellation_policy, status, created_at
       ) VALUES
       ($1, $3, $4, '2026-09-01', '2026-09-03', 2, 2, 20000, 40000, 800, 40800, 30000, 'moderate', 'pending_payment', now() - interval '45 minutes'),
       ($2, $3, $4, '2026-09-10', '2026-09-12', 2, 2, 20000, 40000, 800, 40800, 30000, 'moderate', 'pending_payment', now())`,
      [staleId, freshId, listingId, guestId],
    );

    const { rows } = await pool.query<{ expire_pending_bookings: number }>(
      "SELECT public.expire_pending_bookings()",
    );
    expect(rows[0]?.expire_pending_bookings).toBeGreaterThanOrEqual(1);

    const { rows: statuses } = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[staleId, freshId]],
    );
    expect(statuses.find((r) => r.id === staleId)?.status).toBe("expired");
    expect(statuses.find((r) => r.id === freshId)?.status).toBe("pending_payment");

    const { rows: beat } = await pool.query<{ last_ok: Date | null }>(
      "SELECT last_ok FROM public.cron_heartbeats WHERE job = 'expire-pending'",
    );
    expect(beat[0]?.last_ok).toBeTruthy();
  });
});
