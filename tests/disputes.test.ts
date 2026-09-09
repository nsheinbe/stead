/**
 * Slice 7 — chargeback freeze / unfreeze, against real Postgres and the
 * webhook router. Open disputes freeze payouts and pause escrow actions;
 * a won close unfreezes; a lost close leaves them frozen.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { handleStripeEvent, type WebhookStore } from "../server/lib/stripeWebhook";
import {
  asMember,
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

function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fakeStore(overrides: Partial<WebhookStore> = {}): WebhookStore {
  return {
    claimEvent: async () => true,
    confirmBookingByPaymentIntent: async () => false,
    findExpiredBooking: async () => null,
    recordDisputeOpened: async () => false,
    recordDisputeClosed: async () => false,
    markIdVerified: async () => false,
    recordConnectReadiness: async () => false,
    ...overrides,
  };
}

async function paidStay(opts?: { windowClosed?: boolean }) {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  const bookingId = id();
  const pi = `pi_${bookingId.replaceAll("-", "").slice(0, 16)}`;
  await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
  await insertListing({ id: listingId, hostId });
  await insertBooking({
    id: bookingId,
    listingId,
    guestId,
    checkIn: day(-40),
    checkOut: day(-10),
    status: "confirmed",
    paymentIntentId: pi,
  });

  const depositId = id();
  const payoutId = id();
  await asOwner(async (db) => {
    await db.execute(sql`
      INSERT INTO public.escrow_deposits (id, booking_id, amount_cents, state, method)
      VALUES (${depositId}::uuid, ${bookingId}::uuid, 30000, 'scheduled', 'card_on_file')
    `);
    await db.execute(sql`SELECT app.hold_due_escrows()`);
    await db.execute(sql`SELECT app.open_due_claim_windows()`);
    if (opts?.windowClosed) {
      await db.execute(sql`
        UPDATE public.escrow_deposits
           SET window_closes_at = now() - interval '1 hour'
         WHERE id = ${depositId}::uuid
      `);
    } else {
      await db.execute(sql`
        UPDATE public.escrow_deposits
           SET window_closes_at = now() + interval '2 days'
         WHERE id = ${depositId}::uuid
      `);
    }
    await db.execute(sql`
      INSERT INTO public.payouts (id, booking_id, host_id, amount_cents, state, paid_at)
      VALUES (${payoutId}::uuid, ${bookingId}::uuid, ${hostId}::uuid, 600000, 'paid', now())
    `);
  });

  return { hostId, guestId, listingId, bookingId, depositId, payoutId, pi };
}

async function payoutState(payoutId: string): Promise<string | undefined> {
  return asOwner(async (db) => {
    const rows = (await db.execute(
      sql`SELECT state::text FROM public.payouts WHERE id = ${payoutId}::uuid`,
    )) as unknown as { state: string }[];
    return rows[0]?.state;
  });
}

async function depositState(depositId: string): Promise<string | undefined> {
  return asOwner(async (db) => {
    const rows = (await db.execute(
      sql`SELECT state::text FROM public.escrow_deposits WHERE id = ${depositId}::uuid`,
    )) as unknown as { state: string }[];
    return rows[0]?.state;
  });
}

describe("chargeback webhook router", () => {
  it("opens a dispute from charge.dispute.created", async () => {
    const opened: unknown[] = [];
    const result = await handleStripeEvent(
      {
        id: "evt_dp_open",
        type: "charge.dispute.created",
        data: {
          object: {
            id: "dp_1",
            payment_intent: "pi_stay",
            amount: 612000,
            status: "needs_response",
          },
        },
      },
      fakeStore({
        recordDisputeOpened: async (input) => {
          opened.push(input);
          return true;
        },
      }),
    );
    expect(result.dispute).toBe("opened");
    expect(opened).toEqual([
      {
        disputeId: "dp_1",
        paymentIntentId: "pi_stay",
        amountCents: 612000,
        status: "needs_response",
      },
    ]);
  });

  it("closes a dispute from charge.dispute.closed", async () => {
    const closed: string[] = [];
    const result = await handleStripeEvent(
      {
        id: "evt_dp_close",
        type: "charge.dispute.closed",
        data: { object: { id: "dp_1", status: "won" } },
      },
      fakeStore({
        recordDisputeClosed: async (disputeId, status) => {
          closed.push(`${disputeId}:${status}`);
          return true;
        },
      }),
    );
    expect(result.dispute).toBe("closed");
    expect(closed).toEqual(["dp_1:won"]);
  });

  it("skips a redelivered dispute event", async () => {
    const result = await handleStripeEvent(
      {
        id: "evt_dup",
        type: "charge.dispute.created",
        data: { object: { id: "dp_1", payment_intent: "pi_x" } },
      },
      fakeStore({ claimEvent: async () => false }),
    );
    expect(result).toMatchObject({ skipped: true, dispute: null });
  });
});

describeDb("chargeback freeze and unfreeze", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("freezes a paid payout on open and unfreezes on won", async () => {
    const stay = await paidStay();
    const opened = await asMember(null, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT app.record_dispute_opened(${`dp_${stay.bookingId.slice(0, 8)}`}, ${stay.pi}, 612000, 'needs_response') AS ok
      `)) as unknown as { ok: boolean }[];
      return rows[0]?.ok;
    });
    expect(opened).toBe(true);
    expect(await payoutState(stay.payoutId)).toBe("frozen");

    const closed = await asMember(null, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT app.record_dispute_closed(${`dp_${stay.bookingId.slice(0, 8)}`}, 'won') AS ok
      `)) as unknown as { ok: boolean }[];
      return rows[0]?.ok;
    });
    expect(closed).toBe(true);
    expect(await payoutState(stay.payoutId)).toBe("paid");
  });

  it("leaves the payout frozen when the dispute is lost", async () => {
    const stay = await paidStay();
    await asMember(null, (tx) =>
      tx.execute(sql`
        SELECT app.record_dispute_opened(${`dp_lost_${stay.bookingId.slice(0, 6)}`}, ${stay.pi}, 612000, 'needs_response')
      `),
    );
    await asMember(null, (tx) =>
      tx.execute(sql`
        SELECT app.record_dispute_closed(${`dp_lost_${stay.bookingId.slice(0, 6)}`}, 'lost')
      `),
    );
    expect(await payoutState(stay.payoutId)).toBe("frozen");
  });

  it("pauses deposit release and filing a claim while a dispute is open", async () => {
    const stay = await paidStay({ windowClosed: true });
    await asMember(null, (tx) =>
      tx.execute(sql`
        SELECT app.record_dispute_opened(${`dp_esc_${stay.bookingId.slice(0, 6)}`}, ${stay.pi}, 612000, 'needs_response')
      `),
    );

    const released = await asOwner(async (db) => {
      const rows = (await db.execute(sql`SELECT * FROM app.release_due_escrows()`)) as unknown as unknown[];
      return rows.length;
    });
    expect(released).toBe(0);
    expect(await depositState(stay.depositId)).toBe("claim_window");

    const filed = (await rawAsMember(
      stay.hostId,
      (tx) => tx`SELECT app.file_claim(${stay.bookingId}::uuid, 15000, 'Broken lamp') AS id`,
    )) as { id: string | null }[];
    expect(filed[0]?.id).toBeNull();
  });

  it("refuses a member calling the webhook-only freeze", async () => {
    const stay = await paidStay();
    const ok = (await rawAsMember(
      stay.hostId,
      (tx) =>
        tx`SELECT app.record_dispute_opened(${`dp_mem_${stay.bookingId.slice(0, 6)}`}, ${stay.pi}, 1, 'needs_response') AS ok`,
    )) as { ok: boolean }[];
    expect(ok[0]?.ok).toBe(false);
    expect(await payoutState(stay.payoutId)).toBe("paid");
  });

  it("records a later payout as frozen when the dispute is already open", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const bookingId = id();
    const pi = `pi_${bookingId.replaceAll("-", "").slice(0, 16)}`;
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: day(10),
      checkOut: day(40),
      status: "confirmed",
      paymentIntentId: pi,
    });

    await asMember(null, (tx) =>
      tx.execute(sql`
        SELECT app.record_dispute_opened(${`dp_late_${bookingId.slice(0, 6)}`}, ${pi}, 612000, 'needs_response')
      `),
    );
    const recorded = await asMember(null, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT app.record_payout(${pi}, ${`tr_${bookingId.slice(0, 8)}`}) AS ok`,
      )) as unknown as { ok: boolean }[];
      return rows[0]?.ok;
    });
    expect(recorded).toBe(true);

    const state = await asOwner(async (db) => {
      const rows = (await db.execute(
        sql`SELECT state::text FROM public.payouts WHERE booking_id = ${bookingId}::uuid`,
      )) as unknown as { state: string }[];
      return rows[0]?.state;
    });
    expect(state).toBe("frozen");
  });
});
