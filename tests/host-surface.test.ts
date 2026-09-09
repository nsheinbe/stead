/**
 * Slice 3a — what a host may and may not do, asserted against Postgres.
 *
 * The interesting claims are negative ones: a host cannot touch another host's
 * listing, cannot write the profile columns the platform controls, and cannot
 * see another host's earnings.
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

describeDb("a host's reach over listings", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("stops one host editing or deleting another's listing", async () => {
    const owner = id();
    const other = id();
    const listingId = id();
    await insertMember(owner, `owner-${owner}@stead.example`, "Owner", true);
    await insertMember(other, `other-${other}@stead.example`, "Other", true);
    await insertListing({ id: listingId, hostId: owner, title: "Not yours" });

    // RLS filters rather than raising, so the tell is zero rows affected.
    const updated = await rawAsMember(other, (tx) => tx`
      UPDATE public.listings SET title = 'Taken over' WHERE id = ${listingId}::uuid RETURNING id
    `);
    const deleted = await rawAsMember(other, (tx) => tx`
      DELETE FROM public.listings WHERE id = ${listingId}::uuid RETURNING id
    `);

    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);

    const [row] = await asOwner((db) =>
      db.execute(sql`SELECT title FROM public.listings WHERE id = ${listingId}::uuid`),
    ) as unknown as { title: string }[];
    expect(row?.title).toBe("Not yours");
  });

  it("refuses a listing created under someone else's host id", async () => {
    const owner = id();
    const impostor = id();
    await insertMember(owner, `owner-${owner}@stead.example`, "Owner", true);
    await insertMember(impostor, `imp-${impostor}@stead.example`, "Impostor", true);

    const failure = await rawAsMember(impostor, (tx) => tx`
      INSERT INTO public.listings (host_id, title, type, city, country, timezone,
                                   nightly_rate_cents, deposit_cents, max_guests, status)
      VALUES (${owner}::uuid, 'Planted', 'entire_home', 'Nowhere', 'US', 'UTC', 1000, 0, 1, 'active')
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });
});

describeDb("platform-controlled profile columns", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("lets a member rename themselves", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Before");

    await rawAsMember(member, (tx) => tx`
      UPDATE public.profiles SET display_name = 'After' WHERE id = ${member}::uuid
    `);

    const [row] = await asOwner((db) =>
      db.execute(sql`SELECT display_name FROM public.profiles WHERE id = ${member}::uuid`),
    ) as unknown as { display_name: string }[];
    expect(row?.display_name).toBe("After");
  });

  it("refuses a member pointing their own payouts somewhere", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");

    const failure = await rawAsMember(member, (tx) => tx`
      UPDATE public.profiles SET stripe_connect_account_id = 'acct_attacker'
       WHERE id = ${member}::uuid
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });

  it("refuses a member marking themselves verified", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");

    for (const column of ["id_verified", "phone_verified", "is_ops"]) {
      const failure = await rawAsMember(member, (tx) =>
        tx.unsafe(`UPDATE public.profiles SET ${column} = true WHERE id = '${member}'`),
      ).then(
        () => null,
        (err: unknown) => err,
      );
      expect(failure).not.toBeNull();
    }
  });

  it("attaches a Connect account once and will not repoint it", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");

    const first = await rawAsMember(member, (tx) => tx`
      SELECT app.attach_connect_account('acct_first') AS attached
    `) as unknown as { attached: boolean }[];
    expect(first[0]?.attached).toBe(true);

    const second = await rawAsMember(member, (tx) => tx`
      SELECT app.attach_connect_account('acct_second') AS attached
    `) as unknown as { attached: boolean }[];
    expect(second[0]?.attached).toBe(false);

    const [row] = await asOwner((db) =>
      db.execute(sql`SELECT stripe_connect_account_id, is_host FROM public.profiles WHERE id = ${member}::uuid`),
    ) as unknown as { stripe_connect_account_id: string; is_host: boolean }[];
    expect(row?.stripe_connect_account_id).toBe("acct_first");
    expect(row?.is_host).toBe(true);
  });

  it("records payout readiness from account.updated and refuses a member writing it", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");
    await rawAsMember(member, (tx) => tx`
      SELECT app.attach_connect_account('acct_ready_host') AS attached
    `);

    const recorded = (await rawAsMember(
      null,
      (tx) =>
        tx`SELECT app.record_connect_readiness('acct_ready_host', true, true, true) AS recorded`,
    )) as { recorded: boolean }[];
    expect(recorded[0]?.recorded).toBe(true);

    const [row] = (await asOwner((db) =>
      db.execute(sql`
        SELECT stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted
          FROM public.profiles WHERE id = ${member}::uuid
      `),
    )) as unknown as {
      stripe_charges_enabled: boolean;
      stripe_payouts_enabled: boolean;
      stripe_details_submitted: boolean;
    }[];
    expect(row?.stripe_charges_enabled).toBe(true);
    expect(row?.stripe_payouts_enabled).toBe(true);
    expect(row?.stripe_details_submitted).toBe(true);

    const unknown = (await rawAsMember(
      null,
      (tx) => tx`SELECT app.record_connect_readiness('acct_nobody', true, true, true) AS recorded`,
    )) as { recorded: boolean }[];
    expect(unknown[0]?.recorded).toBe(false);

    const selfWrite = await rawAsMember(
      member,
      (tx) =>
        tx`UPDATE public.profiles SET stripe_payouts_enabled = false WHERE id = ${member}::uuid`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    expect(selfWrite).toBe("refused");
  });

  it("rejects a value that is not a connected account id", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");

    const failure = await rawAsMember(member, (tx) => tx`
      SELECT app.attach_connect_account('sk_live_secret') AS attached
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });
});

describeDb("the payout ledger", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function paidStay() {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const bookingId = id();
    const paymentIntentId = `pi_payout_${bookingId.slice(0, 10)}`;

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2028-04-01",
      checkOut: "2028-05-01",
      status: "confirmed",
      paymentIntentId,
    });
    return { hostId, guestId, bookingId, paymentIntentId };
  }

  it("records the stay subtotal, once, however many times the webhook fires", async () => {
    const { hostId, bookingId, paymentIntentId } = await paidStay();

    const first = await asOwner((db) =>
      db.execute(sql`SELECT app.record_payout(${paymentIntentId}, ${"tr_1"}) AS recorded`),
    ) as unknown as { recorded: boolean }[];
    expect(first[0]?.recorded).toBe(true);

    // A redelivered payment_intent.succeeded must not pay the host twice.
    const replay = await asOwner((db) =>
      db.execute(sql`SELECT app.record_payout(${paymentIntentId}, ${"tr_2"}) AS recorded`),
    ) as unknown as { recorded: boolean }[];
    expect(replay[0]?.recorded).toBe(false);

    const rows = await asOwner((db) =>
      db.execute(sql`
        SELECT p.amount_cents, p.state::text AS state, p.host_id, b.stay_subtotal_cents
          FROM public.payouts p JOIN public.bookings b ON b.id = p.booking_id
         WHERE p.booking_id = ${bookingId}::uuid
      `),
    ) as unknown as {
      amount_cents: number;
      state: string;
      host_id: string;
      stay_subtotal_cents: number;
    }[];

    expect(rows).toHaveLength(1);
    // What lands is the stay subtotal: the platform kept the network fee.
    expect(Number(rows[0]?.amount_cents)).toBe(Number(rows[0]?.stay_subtotal_cents));
    expect(rows[0]?.state).toBe("paid");
    expect(rows[0]?.host_id).toBe(hostId);
  });

  it("shows a payout to its host and to nobody else", async () => {
    const { hostId, guestId, paymentIntentId, bookingId } = await paidStay();
    await asOwner((db) =>
      db.execute(sql`SELECT app.record_payout(${paymentIntentId}, ${"tr_read"})`),
    );

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.payouts WHERE booking_id = ${bookingId}::uuid`);

    expect(await read(hostId)).toHaveLength(1);
    // The guest paid, but a host's earnings are not the guest's business.
    expect(await read(guestId)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("refuses a host writing their own payout", async () => {
    const { hostId, bookingId } = await paidStay();

    const failure = await rawAsMember(hostId, (tx) => tx`
      INSERT INTO public.payouts (booking_id, host_id, amount_cents, state)
      VALUES (${bookingId}::uuid, ${hostId}::uuid, 9999999, 'paid')
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });

  it("will not record a payout for a booking that was never paid", async () => {
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
      checkIn: "2028-06-01",
      checkOut: "2028-07-01",
      status: "pending_payment",
      paymentIntentId: `pi_unpaid_${bookingId.slice(0, 10)}`,
    });

    const rows = await asOwner((db) =>
      db.execute(sql`SELECT app.record_payout(${`pi_unpaid_${bookingId.slice(0, 10)}`}, null) AS recorded`),
    ) as unknown as { recorded: boolean }[];
    expect(rows[0]?.recorded).toBe(false);
  });
});
