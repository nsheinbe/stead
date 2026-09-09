/**
 * Slice 3b — legal and illegal claim paths, against real Postgres.
 *
 * The transitions live in SECURITY DEFINER functions, so these call them the
 * way the routes do (as the member, with app.user_id set) and assert on what
 * Postgres actually did: claim state, escrow state, and the audit trail.
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
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

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

function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function openWindowStay() {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  const bookingId = id();
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
    paymentIntentId: `pi_${bookingId.slice(0, 12)}`,
  });

  const depositId = id();
  await asOwner(async (db) => {
    await db.execute(sql`
      INSERT INTO public.escrow_deposits (id, booking_id, amount_cents, state, method)
      VALUES (${depositId}::uuid, ${bookingId}::uuid, 30000, 'scheduled', 'card_on_file')
    `);
    await db.execute(sql`SELECT app.hold_due_escrows()`);
    await db.execute(sql`SELECT app.open_due_claim_windows()`);
    await db.execute(sql`
      UPDATE public.escrow_deposits
         SET window_closes_at = now() + interval '2 days'
       WHERE id = ${depositId}::uuid
    `);
  });

  return { hostId, guestId, listingId, bookingId, depositId };
}

async function fileAsHost(hostId: string, bookingId: string, amount = 15000, description = "Broken lamp") {
  const rows = (await rawAsMember(
    hostId,
    (tx) => tx`SELECT app.file_claim(${bookingId}::uuid, ${amount}, ${description}) AS id`,
  )) as { id: string | null }[];
  return rows[0]?.id ?? null;
}

async function claimRow(claimId: string) {
  return asOwner(async (db) => {
    const rows = (await db.execute(sql`
      SELECT state::text, amount_cents, resolution_amount_cents, resolution_note
        FROM public.claims WHERE id = ${claimId}::uuid
    `)) as unknown as {
      state: string;
      amount_cents: number;
      resolution_amount_cents: number | null;
      resolution_note: string | null;
    }[];
    return rows[0];
  });
}

async function depositState(depositId: string) {
  return asOwner(async (db) => {
    const rows = (await db.execute(sql`
      SELECT state::text, resolved_amount_cents
        FROM public.escrow_deposits WHERE id = ${depositId}::uuid
    `)) as unknown as { state: string; resolved_amount_cents: number | null }[];
    return rows[0];
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

async function markArbiter(memberId: string) {
  await asOwner((db) =>
    db.execute(sql`UPDATE public.profiles SET is_arbiter = true WHERE id = ${memberId}::uuid`),
  );
}

describeDb("legal claim paths", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("files during the window, guest accepts, escrow releases the claimed amount", async () => {
    const { hostId, guestId, bookingId, depositId } = await openWindowStay();
    const claimId = await fileAsHost(hostId, bookingId, 12000, "Stained rug");
    expect(claimId).toBeTruthy();
    expect((await claimRow(claimId as string))?.state).toBe("open");
    expect((await depositState(depositId))?.state).toBe("claimed");

    const accepted = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, true, ${"pi_claim_accept"}) AS ok`,
    )) as { ok: boolean }[];
    expect(accepted[0]?.ok).toBe(true);

    const claim = await claimRow(claimId as string);
    expect(claim?.state).toBe("resolved_host");
    expect(Number(claim?.resolution_amount_cents)).toBe(12000);

    const deposit = await depositState(depositId);
    expect(deposit?.state).toBe("released");
    expect(Number(deposit?.resolved_amount_cents)).toBe(12000);

    const trail = await auditTrail(depositId);
    expect(trail.map((r) => r.to_state)).toEqual(["held", "claim_window", "claimed", "released"]);
    expect(trail.at(-1)).toMatchObject({ from_state: "claimed", actor: "guest:accept-claim" });
  });

  it("disputes then splits, moving escrow to arbitrated", async () => {
    const { hostId, guestId, bookingId, depositId } = await openWindowStay();
    const arbiter = id();
    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await markArbiter(arbiter);

    const claimId = await fileAsHost(hostId, bookingId, 20000, "Missing chairs");
    const disputed = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, false, null) AS ok`,
    )) as { ok: boolean }[];
    expect(disputed[0]?.ok).toBe(true);
    expect((await claimRow(claimId as string))?.state).toBe("guest_disputed");
    expect((await depositState(depositId))?.state).toBe("disputed");

    const resolved = (await rawAsMember(
      arbiter,
      (tx) =>
        tx`SELECT app.resolve_claim(${claimId}::uuid, ${"split"}, ${8000}, ${"Wear and tear"}, ${"pi_split"}) AS ok`,
    )) as { ok: boolean }[];
    expect(resolved[0]?.ok).toBe(true);

    const claim = await claimRow(claimId as string);
    expect(claim?.state).toBe("resolved_split");
    expect(Number(claim?.resolution_amount_cents)).toBe(8000);
    expect(claim?.resolution_note).toBe("Wear and tear");

    const deposit = await depositState(depositId);
    expect(deposit?.state).toBe("arbitrated");
    expect(Number(deposit?.resolved_amount_cents)).toBe(8000);
    expect(await auditTrail(depositId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from_state: "claimed", to_state: "disputed", actor: "guest:dispute-claim" }),
        expect.objectContaining({ from_state: "disputed", to_state: "arbitrated", actor: "arbiter:resolve-claim" }),
      ]),
    );
  });

  it("arbiter can resolve wholly for the host or the guest", async () => {
    const hostWin = await openWindowStay();
    const guestWin = await openWindowStay();
    const arbiter = id();
    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await markArbiter(arbiter);

    const hostClaim = await fileAsHost(hostWin.hostId, hostWin.bookingId, 5000, "Host win");
    await rawAsMember(hostWin.guestId, (tx) => tx`SELECT app.respond_claim(${hostClaim}::uuid, false, null)`);
    const hostResolved = (await rawAsMember(
      arbiter,
      (tx) => tx`SELECT app.resolve_claim(${hostClaim}::uuid, ${"host"}, null, null, null) AS ok`,
    )) as { ok: boolean }[];
    expect(hostResolved[0]?.ok).toBe(true);
    expect((await claimRow(hostClaim as string))?.state).toBe("resolved_host");
    expect(Number((await depositState(hostWin.depositId))?.resolved_amount_cents)).toBe(5000);

    const guestClaim = await fileAsHost(guestWin.hostId, guestWin.bookingId, 5000, "Guest win");
    await rawAsMember(guestWin.guestId, (tx) => tx`SELECT app.respond_claim(${guestClaim}::uuid, false, null)`);
    const guestResolved = (await rawAsMember(
      arbiter,
      (tx) => tx`SELECT app.resolve_claim(${guestClaim}::uuid, ${"guest"}, null, null, null) AS ok`,
    )) as { ok: boolean }[];
    expect(guestResolved[0]?.ok).toBe(true);
    expect((await claimRow(guestClaim as string))?.state).toBe("resolved_guest");
    expect(Number((await depositState(guestWin.depositId))?.resolved_amount_cents)).toBe(0);
    expect((await depositState(guestWin.depositId))?.state).toBe("arbitrated");
  });
});

describeDb("illegal claim edges", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("the guest cannot file, and a second file is a no-op", async () => {
    const { hostId, guestId, bookingId } = await openWindowStay();

    const asGuest = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.file_claim(${bookingId}::uuid, 1000, ${"Nope"}) AS id`,
    )) as { id: string | null }[];
    expect(asGuest[0]?.id).toBeNull();

    const first = await fileAsHost(hostId, bookingId);
    const second = await fileAsHost(hostId, bookingId, 2000, "Again");
    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it("refuses an amount over the deposit or a blank description", async () => {
    const { hostId, bookingId } = await openWindowStay();

    const over = await rawAsMember(hostId, (tx) =>
      tx`SELECT app.file_claim(${bookingId}::uuid, 30001, ${"Too much"})`,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(over).not.toBeNull();
    expect(pgMessage(over)).toMatch(/between 1 and the deposit/);

    const blank = await rawAsMember(hostId, (tx) =>
      tx`SELECT app.file_claim(${bookingId}::uuid, 1000, ${"   "})`,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(blank).not.toBeNull();
    expect(pgMessage(blank)).toMatch(/description is required/);
  });

  it("will not file after the window has closed", async () => {
    const { hostId, bookingId, depositId } = await openWindowStay();
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.escrow_deposits SET window_closes_at = now() - interval '1 minute'
         WHERE id = ${depositId}::uuid
      `),
    );
    expect(await fileAsHost(hostId, bookingId)).toBeNull();
  });

  it("the host cannot respond, and a stranger cannot accept", async () => {
    const { hostId, guestId, bookingId } = await openWindowStay();
    const stranger = id();
    await insertMember(stranger, `s-${stranger}@stead.example`, "Stranger");
    const claimId = await fileAsHost(hostId, bookingId);

    const asHost = (await rawAsMember(
      hostId,
      (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, true, null) AS ok`,
    )) as { ok: boolean }[];
    expect(asHost[0]?.ok).toBe(false);

    const asStranger = (await rawAsMember(
      stranger,
      (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, true, null) AS ok`,
    )) as { ok: boolean }[];
    expect(asStranger[0]?.ok).toBe(false);
    expect((await claimRow(claimId as string))?.state).toBe("open");

    // Sanity: the guest still can.
    const asGuest = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, false, null) AS ok`,
    )) as { ok: boolean }[];
    expect(asGuest[0]?.ok).toBe(true);
  });

  it("a non-arbiter cannot resolve, and resolve is refused while the claim is still open", async () => {
    const { hostId, guestId, bookingId } = await openWindowStay();
    const claimId = await fileAsHost(hostId, bookingId);

    const asGuest = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.resolve_claim(${claimId}::uuid, ${"split"}, 1, null, null) AS ok`,
    )) as { ok: boolean }[];
    expect(asGuest[0]?.ok).toBe(false);

    const arbiter = id();
    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await markArbiter(arbiter);

    const whileOpen = (await rawAsMember(
      arbiter,
      (tx) => tx`SELECT app.resolve_claim(${claimId}::uuid, ${"host"}, null, null, null) AS ok`,
    )) as { ok: boolean }[];
    expect(whileOpen[0]?.ok).toBe(false);

    await rawAsMember(guestId, (tx) => tx`SELECT app.respond_claim(${claimId}::uuid, false, null)`);

    const badSplit = await rawAsMember(arbiter, (tx) =>
      tx`SELECT app.resolve_claim(${claimId}::uuid, ${"split"}, 20000, null, null)`,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(badSplit).not.toBeNull();
    expect(pgMessage(badSplit)).toMatch(/just under the claim/);
  });

  it("an open claim blocks release after the window closes", async () => {
    const { hostId, bookingId, depositId } = await openWindowStay();
    await fileAsHost(hostId, bookingId);
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.escrow_deposits SET window_closes_at = now() - interval '1 hour'
         WHERE id = ${depositId}::uuid
      `),
    );

    await asOwner((db) => db.execute(sql`SELECT app.release_due_escrows()`));
    expect((await depositState(depositId))?.state).toBe("claimed");
  });

  it("release still runs when the window closed with no claim", async () => {
    const { depositId } = await openWindowStay();
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.escrow_deposits SET window_closes_at = now() - interval '1 hour'
         WHERE id = ${depositId}::uuid
      `),
    );
    await asOwner((db) => db.execute(sql`SELECT app.release_due_escrows()`));
    expect((await depositState(depositId))?.state).toBe("released");
  });
});
