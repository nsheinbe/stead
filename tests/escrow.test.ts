/**
 * Slice 2 — the escrow state machine, against real Postgres.
 *
 * The transitions live in SECURITY DEFINER functions, so these call them the
 * way the crons do and assert on what Postgres actually did: the deposit state,
 * the booking status alongside it, and the escrow_audit trail.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  asOwner,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

/** Drizzle wraps driver errors, so the Postgres message is down the cause chain. */
function pgMessage(err: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    const message = (cursor as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/** yyyy-mm-dd, `days` from today. */
function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function scheduleDeposit(
  bookingId: string,
  method: "card_on_file" | "auth_hold" = "card_on_file",
): Promise<string> {
  const depositId = id();
  await asOwner(async (db) => {
    await db.execute(sql`
      INSERT INTO public.escrow_deposits (id, booking_id, amount_cents, state, method)
      VALUES (${depositId}::uuid, ${bookingId}::uuid, 30000, 'scheduled',
              ${method}::public.escrow_method)
    `);
  });
  return depositId;
}

async function depositRow(depositId: string) {
  return asOwner(async (db) => {
    const rows = (await db.execute(sql`
      SELECT state::text, held_at, window_closes_at, released_at, resolved_amount_cents
        FROM public.escrow_deposits WHERE id = ${depositId}::uuid
    `)) as unknown as {
      state: string;
      held_at: string | null;
      window_closes_at: string | null;
      released_at: string | null;
      resolved_amount_cents: number | null;
    }[];
    return rows[0];
  });
}

async function bookingStatus(bookingId: string): Promise<string | undefined> {
  return asOwner(async (db) => {
    const rows = (await db.execute(
      sql`SELECT status::text FROM public.bookings WHERE id = ${bookingId}::uuid`,
    )) as unknown as { status: string }[];
    return rows[0]?.status;
  });
}

async function auditTrail(depositId: string) {
  return asOwner(async (db) => {
    const rows = (await db.execute(sql`
      SELECT from_state::text AS from_state, to_state::text AS to_state, actor
        FROM public.escrow_audit WHERE deposit_id = ${depositId}::uuid ORDER BY at ASC
    `)) as unknown as { from_state: string | null; to_state: string; actor: string }[];
    return rows;
  });
}

/** A confirmed 30-night stay, offset from today, in the given zone. */
async function stay(opts: { checkInOffset: number; timezone?: string }) {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
  await insertListing({ id: listingId, hostId, timezone: opts.timezone ?? "America/New_York" });

  const bookingId = id();
  await insertBooking({
    id: bookingId,
    listingId,
    guestId,
    checkIn: day(opts.checkInOffset),
    checkOut: day(opts.checkInOffset + 30),
    status: "confirmed",
    paymentIntentId: `pi_${bookingId.slice(0, 12)}`,
  });
  return { bookingId, listingId, guestId, paymentIntentId: `pi_${bookingId.slice(0, 12)}` };
}

describeDb("escrow lifecycle", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("carries a stay from scheduled through to released, with an audit row each step", async () => {
    // Started 40 days ago, ended 10 days ago: check-in, checkout and the
    // 48-hour claim window have all passed.
    const { bookingId } = await stay({ checkInOffset: -40 });
    const depositId = await scheduleDeposit(bookingId);

    const held = await asOwner((db) => db.execute(sql`SELECT app.hold_due_escrows() AS n`)) as unknown as { n: number }[];
    expect(Number(held[0]?.n)).toBe(1);
    expect((await depositRow(depositId))?.state).toBe("held");
    expect(await bookingStatus(bookingId)).toBe("checked_in");

    const opened = await asOwner((db) => db.execute(sql`SELECT app.open_due_claim_windows() AS n`)) as unknown as { n: number }[];
    expect(Number(opened[0]?.n)).toBe(1);
    const windowed = await depositRow(depositId);
    expect(windowed?.state).toBe("claim_window");
    expect(windowed?.window_closes_at).not.toBeNull();
    expect(await bookingStatus(bookingId)).toBe("completed");

    const released = await asOwner((db) =>
      db.execute(sql`SELECT deposit_id FROM app.release_due_escrows()`),
    ) as unknown as { deposit_id: string }[];
    expect(released.some((r) => r.deposit_id === depositId)).toBe(true);
    const final = await depositRow(depositId);
    expect(final?.state).toBe("released");
    expect(final?.released_at).not.toBeNull();
    // Nothing was ever captured on a card_on_file deposit.
    expect(Number(final?.resolved_amount_cents)).toBe(0);

    expect(await auditTrail(depositId)).toEqual([
      { from_state: "scheduled", to_state: "held", actor: "cron:check-in" },
      { from_state: "held", to_state: "claim_window", actor: "cron:check-out" },
      { from_state: "claim_window", to_state: "released", actor: "cron:release-deposits" },
    ]);
  });

  it("does not hold a stay whose listing-local check-in has not arrived", async () => {
    // 16:00 today in Pacific/Midway (UTC-11) is 03:00 UTC tomorrow, so this is
    // in the future for the whole of today no matter when the suite runs. An
    // implementation comparing dates in UTC would wrongly hold it.
    const { bookingId } = await stay({ checkInOffset: 0, timezone: "Pacific/Midway" });
    const depositId = await scheduleDeposit(bookingId);

    await asOwner((db) => db.execute(sql`SELECT app.hold_due_escrows()`));

    expect((await depositRow(depositId))?.state).toBe("scheduled");
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("re-running a job changes nothing", async () => {
    const { bookingId } = await stay({ checkInOffset: -40 });
    const depositId = await scheduleDeposit(bookingId);

    await asOwner((db) => db.execute(sql`SELECT app.hold_due_escrows()`));
    await asOwner((db) => db.execute(sql`SELECT app.hold_due_escrows()`));

    expect((await depositRow(depositId))?.state).toBe("held");
    // One audit row, not two: the second pass matched no rows in 'scheduled'.
    expect(await auditTrail(depositId)).toHaveLength(1);
  });

  it("will not open a claim window on a deposit that was never held", async () => {
    const { bookingId } = await stay({ checkInOffset: -40 });
    const depositId = await scheduleDeposit(bookingId);

    // scheduled → claim_window is not a legal edge; the from_state guard means
    // this matches nothing rather than skipping a state.
    await asOwner((db) => db.execute(sql`SELECT app.open_due_claim_windows()`));

    expect((await depositRow(depositId))?.state).toBe("scheduled");
    expect(await auditTrail(depositId)).toHaveLength(0);
  });

  it("will not release a deposit whose claim window is still open", async () => {
    const { bookingId } = await stay({ checkInOffset: -40 });
    const depositId = await scheduleDeposit(bookingId);
    await asOwner((db) => db.execute(sql`SELECT app.hold_due_escrows()`));
    await asOwner((db) => db.execute(sql`SELECT app.open_due_claim_windows()`));

    // Push the window into the future; release must leave it alone.
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.escrow_deposits SET window_closes_at = now() + interval '2 days'
         WHERE id = ${depositId}::uuid
      `),
    );
    await asOwner((db) => db.execute(sql`SELECT app.release_due_escrows()`));

    expect((await depositRow(depositId))?.state).toBe("claim_window");
  });

  it("refuses an auth_hold deposit rather than treating it as held", async () => {
    const { bookingId } = await stay({ checkInOffset: -40 });
    await scheduleDeposit(bookingId, "auth_hold");

    const failure = await asOwner((db) =>
      db.execute(sql`SELECT app.hold_due_escrows()`),
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
    expect(pgMessage(failure)).toMatch(/auth_hold/);
  });
});

describeDb("payment that settles after the booking expired", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("refunds the whole guest_total once, and closes the escrow", async () => {
    const { bookingId, paymentIntentId } = await stay({ checkInOffset: 10 });
    const depositId = await scheduleDeposit(bookingId);
    await asOwner((db) =>
      db.execute(sql`UPDATE public.bookings SET status = 'expired' WHERE id = ${bookingId}::uuid`),
    );

    const found = await asOwner((db) =>
      db.execute(sql`SELECT guest_total_cents FROM app.expired_booking_for_payment_intent(${paymentIntentId})`),
    ) as unknown as { guest_total_cents: number }[];
    expect(found).toHaveLength(1);

    const refundedRows = await asOwner((db) =>
      db.execute(sql`
        SELECT app.refund_expired_booking(${paymentIntentId}, ${"re_" + bookingId.slice(0, 10)},
               ${Number(found[0]?.guest_total_cents)}) AS refunded
      `),
    ) as unknown as { refunded: boolean }[];
    expect(refundedRows[0]?.refunded).toBe(true);

    const deposit = await depositRow(depositId);
    expect(deposit?.state).toBe("released");
    expect(await auditTrail(depositId)).toEqual([
      { from_state: "scheduled", to_state: "released", actor: "webhook:payment_after_expiry" },
    ]);

    // A redelivery must not refund twice.
    const replay = await asOwner((db) =>
      db.execute(sql`
        SELECT app.refund_expired_booking(${paymentIntentId}, ${"re_" + bookingId.slice(0, 10)}, 1) AS refunded
      `),
    ) as unknown as { refunded: boolean }[];
    expect(replay[0]?.refunded).toBe(false);

    // And the lookup no longer offers it up.
    const again = await asOwner((db) =>
      db.execute(sql`SELECT 1 AS x FROM app.expired_booking_for_payment_intent(${paymentIntentId})`),
    ) as unknown as { x: number }[];
    expect(again).toHaveLength(0);
  });

  it("leaves a live booking alone", async () => {
    const { paymentIntentId } = await stay({ checkInOffset: 10 });
    const rows = await asOwner((db) =>
      db.execute(sql`SELECT 1 AS x FROM app.expired_booking_for_payment_intent(${paymentIntentId})`),
    ) as unknown as { x: number }[];
    expect(rows).toHaveLength(0);
  });
});
