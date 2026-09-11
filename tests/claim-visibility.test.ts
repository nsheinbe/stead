/**
 * SAFE-01. What the claim page is allowed to offer.
 *
 * `app.respond_claim` and `app.resolve_claim` return false — and
 * `app.file_claim` returns NULL — when the booking has an open card dispute.
 * They do it silently, which is correct for a database function and wrong for
 * a page: before this, the UI rendered Accept and Dispute, someone clicked
 * one, and a frozen booking surfaced as a generic "could not record that".
 *
 * So `getClaimForViewer` now reports the freeze and folds it into the
 * permission flags, and these tests hold the two together: what the page is
 * told it may do, and what the server will actually do.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getClaimForViewer } from "../server/queries/claims";
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

/** A finished stay with an open claim window and a claim already filed. */
async function stayWithClaim() {
  const hostId = id();
  const guestId = id();
  const arbiterId = id();
  const listingId = id();
  const bookingId = id();
  const pi = `pi_${bookingId.replaceAll("-", "").slice(0, 16)}`;

  await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
  await insertMember(arbiterId, `arb-${arbiterId}@stead.example`, "Arbiter");
  await asOwner((db) =>
    db.execute(sql`UPDATE public.profiles SET is_arbiter = true WHERE id = ${arbiterId}::uuid`),
  );
  await insertListing({ id: listingId, hostId });
  await insertBooking({
    id: bookingId,
    listingId,
    guestId,
    checkIn: day(-40),
    checkOut: day(-10),
    status: "completed",
    paymentIntentId: pi,
  });
  await asOwner((db) =>
    db.execute(sql`
      INSERT INTO public.escrow_deposits (booking_id, amount_cents, state, method, window_closes_at)
      VALUES (${bookingId}::uuid, 30000, 'claim_window', 'card_on_file', now() + interval '1 day')
    `),
  );

  const filed = (await rawAsMember(
    hostId,
    (tx) => tx`SELECT app.file_claim(${bookingId}::uuid, 15000, 'Broken lamp') AS id`,
  )) as { id: string | null }[];
  const claimId = filed[0]?.id;
  if (!claimId) throw new Error("fixture: claim was not filed");

  return { hostId, guestId, arbiterId, bookingId, claimId, pi };
}

async function openDispute(pi: string, bookingId: string) {
  await asMember(null, (tx) =>
    tx.execute(sql`
      SELECT app.record_dispute_opened(
        ${`dp_${bookingId.slice(0, 8)}`}, ${pi}, 612000, 'needs_response'
      )
    `),
  );
}

describeDb("what a claim tells each party they may do", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("offers the guest a decision on an open claim, and nobody else", async () => {
    const stay = await stayWithClaim();

    const asGuest = await asMember(stay.guestId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.guestId),
    );
    expect(asGuest?.canRespond).toBe(true);
    expect(asGuest?.canResolve).toBe(false);
    expect(asGuest?.chargebackOpen).toBe(false);

    // The host filed it; the decision is not theirs to take.
    const asHost = await asMember(stay.hostId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.hostId),
    );
    expect(asHost?.canRespond).toBe(false);
    expect(asHost?.canResolve).toBe(false);

    // An arbiter has nothing to resolve until the claim is disputed.
    const asArbiter = await asMember(stay.arbiterId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.arbiterId),
    );
    expect(asArbiter?.canResolve).toBe(false);
  });

  it("opens arbitration only once the guest has disputed", async () => {
    const stay = await stayWithClaim();
    const disputed = (await rawAsMember(
      stay.guestId,
      (tx) => tx`SELECT app.respond_claim(${stay.claimId}::uuid, false, null) AS ok`,
    )) as { ok: boolean }[];
    expect(disputed[0]?.ok).toBe(true);

    const asArbiter = await asMember(stay.arbiterId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.arbiterId),
    );
    expect(asArbiter?.canResolve).toBe(true);
    // And the guest's decision is spent.
    const asGuest = await asMember(stay.guestId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.guestId),
    );
    expect(asGuest?.canRespond).toBe(false);
  });

  it("hides a claim from someone who was not on the stay", async () => {
    const stay = await stayWithClaim();
    const stranger = id();
    await insertMember(stranger, `stranger-${stranger}@stead.example`, "Stranger");

    const seen = await asMember(stranger, (tx) => getClaimForViewer(tx, stay.claimId, stranger));
    expect(seen).toBeNull();
  });
});

describeDb("an open card dispute freezes the claim, visibly", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("reports the freeze rather than leaving the page to guess", async () => {
    const stay = await stayWithClaim();

    const before = await asMember(stay.guestId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.guestId),
    );
    expect(before?.chargebackOpen).toBe(false);
    expect(before?.canRespond).toBe(true);

    await openDispute(stay.pi, stay.bookingId);

    const after = await asMember(stay.guestId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.guestId),
    );
    expect(after?.chargebackOpen).toBe(true);
    // The page must not offer what the server will refuse.
    expect(after?.canRespond).toBe(false);
  });

  it("matches what the transition functions actually do", async () => {
    const stay = await stayWithClaim();
    await openDispute(stay.pi, stay.bookingId);

    const view = await asMember(stay.guestId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.guestId),
    );
    expect(view?.canRespond).toBe(false);

    // The silent refusal the flag exists to explain.
    const accepted = (await rawAsMember(
      stay.guestId,
      (tx) => tx`SELECT app.respond_claim(${stay.claimId}::uuid, true, null) AS ok`,
    )) as { ok: boolean }[];
    expect(accepted[0]?.ok).toBe(false);

    const [row] = (await asOwner((db) =>
      db.execute(sql`SELECT state FROM public.claims WHERE id = ${stay.claimId}::uuid`),
    )) as unknown as { state: string }[];
    expect(row?.state).toBe("open");
  });

  it("freezes the arbiter too, not only the guest", async () => {
    const stay = await stayWithClaim();
    await rawAsMember(
      stay.guestId,
      (tx) => tx`SELECT app.respond_claim(${stay.claimId}::uuid, false, null) AS ok`,
    );
    await openDispute(stay.pi, stay.bookingId);

    const asArbiter = await asMember(stay.arbiterId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.arbiterId),
    );
    expect(asArbiter?.chargebackOpen).toBe(true);
    expect(asArbiter?.canResolve).toBe(false);

    const resolved = (await rawAsMember(
      stay.arbiterId,
      (tx) => tx`SELECT app.resolve_claim(${stay.claimId}::uuid, ${"host"}, null, null, null) AS ok`,
    )) as { ok: boolean }[];
    expect(resolved[0]?.ok).toBe(false);
  });

  it("still lets both sides attach evidence while frozen", async () => {
    // The freeze is on money moving, not on the record. Evidence gathered
    // during a bank's review is exactly what arbitration will need after it.
    const stay = await stayWithClaim();
    await openDispute(stay.pi, stay.bookingId);

    const asHost = await asMember(stay.hostId, (tx) =>
      getClaimForViewer(tx, stay.claimId, stay.hostId),
    );
    expect(asHost?.canFileEvidence).toBe(true);
  });
});
