/**
 * Adversarial RLS suite.
 *
 * These probes talk to Postgres directly as app_user, bypassing every line of
 * query code, so what they assert is what the database enforces. If someone
 * deletes a WHERE clause in server/queries tomorrow, tests/authorization.test.ts
 * goes red; if someone deletes a policy, this file does.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { assertTenantRole, describeRole, PrivilegedRoleError } from "../server/db/client";
import {
  asOwner,
  closeTestDb,
  getHarness,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("the connection role", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("has RLS actually applying to app_user", async () => {
    const { app } = await getHarness();
    const shape = await describeRole(app);
    expect(shape).toMatchObject({
      role: "app_user",
      is_superuser: false,
      bypasses_rls: false,
      owns_tenant_tables: false,
      rls_active: true,
    });
    await expect(assertTenantRole(app)).resolves.toBeUndefined();
  });

  it("refuses to serve tenant traffic as the table owner", async () => {
    // The exact mistake Neon invites: one connection string, for a role that
    // owns everything. Nothing would error; queries would just return everyone's rows.
    const { owner } = await getHarness();
    const shape = await describeRole(owner);
    expect(shape.rls_active).toBe(false);
    expect(shape.owns_tenant_tables || shape.bypasses_rls || shape.is_superuser).toBe(true);

    await expect(assertTenantRole(owner)).rejects.toBeInstanceOf(PrivilegedRoleError);
    await expect(assertTenantRole(owner)).rejects.toThrow(/Refusing to serve tenant traffic/);
  });
});

describeDb("bookings are visible only to their parties", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("guest A cannot read guest B's booking, and the host of the listing can", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "RLS cottage" });
    const bookingId = await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2027-01-08",
      checkOut: "2027-02-07",
      status: "confirmed",
    });

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.bookings WHERE id = ${bookingId}::uuid`);

    expect(await read(guestA)).toHaveLength(1);
    expect(await read(hostId)).toHaveLength(1);
    expect(await read(guestB)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("an unscoped SELECT still returns only the caller's rows", async () => {
    // The realistic bug: someone forgets the WHERE clause. RLS makes that
    // return nothing rather than everything.
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Unscoped cottage" });

    const mine = await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2027-03-08",
      checkOut: "2027-04-07",
      status: "confirmed",
    });
    await insertBooking({
      listingId,
      guestId: guestB,
      checkIn: "2027-04-08",
      checkOut: "2027-05-08",
      status: "confirmed",
    });

    const rows = await rawAsMember(guestA, (tx) => tx`SELECT id FROM public.bookings`);
    expect(rows.map((r) => r.id)).toEqual([mine]);
  });
});

describeDb("state transitions are closed to app_user", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("cannot update a booking's status directly, only through the transition function", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const paymentIntentId = `pi_${id()}`;

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId, title: "Transition cottage" });
    const bookingId = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-05-08",
      checkOut: "2027-06-07",
      paymentIntentId,
    });

    await expect(
      rawAsMember(guestId, (tx) =>
        tx`UPDATE public.bookings SET status = 'confirmed' WHERE id = ${bookingId}::uuid`,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const confirmed = await rawAsMember(
      null,
      (tx) => tx`SELECT app.confirm_booking_for_payment_intent(${paymentIntentId}) AS ok`,
    );
    expect(confirmed[0]?.ok).toBe(true);
  });

  it("cannot open a checkout in someone else's name", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Impersonation cottage" });

    const insertAs = (actor: string, guestId: string) =>
      rawAsMember(
        actor,
        (tx) => tx`
          INSERT INTO public.bookings (
            listing_id, guest_id, check_in, check_out, guests, nights,
            nightly_rate_cents, stay_subtotal_cents, network_fee_cents, network_fee_bps,
            guest_total_cents, deposit_cents, cancellation_policy, status
          ) VALUES (
            ${listingId}::uuid, ${guestId}::uuid, '2027-09-01', '2027-10-01', 2, 30,
            20000, 600000, 12000, 200, 612000, 30000, 'moderate', 'pending_payment'
          )
        `,
      );

    // 42501 is "new row violates row-level security policy".
    await expect(insertAs(guestA, guestB)).rejects.toMatchObject({ code: "42501" });
    await expect(insertAs(guestA, guestA)).resolves.toBeDefined();
  });

  it("cannot insert a booking that starts anywhere but pending_payment", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId, title: "Head start cottage" });

    await expect(
      rawAsMember(
        guestId,
        (tx) => tx`
          INSERT INTO public.bookings (
            listing_id, guest_id, check_in, check_out, guests, nights,
            nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
            deposit_cents, cancellation_policy, status
          ) VALUES (
            ${listingId}::uuid, ${guestId}::uuid, '2027-10-01', '2027-10-31', 2, 30,
            20000, 600000, 12000, 612000, 30000, 'moderate', 'confirmed'
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describeDb("tables app_user has no business reading", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("denies stripe_events and cron_heartbeats outright", async () => {
    await expect(
      rawAsMember(null, (tx) => tx`SELECT * FROM public.stripe_events`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rawAsMember(null, (tx) => tx`SELECT * FROM public.cron_heartbeats`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies stripe_disputes and review_reminders outright", async () => {
    await expect(
      rawAsMember(null, (tx) => tx`SELECT * FROM public.stripe_disputes`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rawAsMember(null, (tx) => tx`SELECT * FROM public.review_reminders`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies the identity tables — those belong to auth_user", async () => {
    for (const table of ["users", "accounts", "sessions", "verification_tokens"]) {
      await expect(
        rawAsMember(null, (tx) => tx.unsafe(`SELECT * FROM public.${table}`)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("keeps app_user and auth_user grants disjoint", async () => {
    const { owner } = await getHarness();
    const overlap = (await owner.execute(`
      SELECT table_name
        FROM information_schema.role_table_grants
       WHERE grantee = 'app_user' AND table_schema = 'public'
      INTERSECT
      SELECT table_name
        FROM information_schema.role_table_grants
       WHERE grantee = 'auth_user' AND table_schema = 'public'
    `)) as unknown as { table_name: string }[];
    expect(overlap).toEqual([]);
  });
});

describeDb("listing visibility", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("hides a paused listing from everyone but its host", async () => {
    const hostId = id();
    const strangerId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(strangerId, `stranger-${strangerId}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId, title: "Paused cottage", status: "paused" });

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.listings WHERE id = ${listingId}::uuid`);

    expect(await read(null)).toHaveLength(0);
    expect(await read(strangerId)).toHaveLength(0);
    expect(await read(hostId)).toHaveLength(1);
  });

  it("stops a member editing a listing they do not host", async () => {
    const hostId = id();
    const strangerId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(strangerId, `stranger-${strangerId}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId, title: "Someone else's cottage" });

    const updated = await rawAsMember(
      strangerId,
      (tx) =>
        tx`UPDATE public.listings SET nightly_rate_cents = 1 WHERE id = ${listingId}::uuid RETURNING id`,
    );
    // The USING clause filters the row out rather than raising: nothing to update.
    expect(updated).toHaveLength(0);
  });
});

describeDb("regulatory columns stay behind existing policies", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("a stranger cannot write another host's permit_number or Connect account", async () => {
    const hostId = id();
    const strangerId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(strangerId, `stranger-${strangerId}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId, title: "Permit cottage" });

    const listingTouched = await rawAsMember(
      strangerId,
      (tx) =>
        tx`UPDATE public.listings SET permit_number = 'SM-FAKE' WHERE id = ${listingId}::uuid RETURNING id`,
    );
    expect(listingTouched).toHaveLength(0);

    // This used to be filtered to zero rows by profiles_self_update. Since
    // 0006 the column grant refuses it outright, which is stronger: writing
    // stripe_connect_account_id is now denied to every member including the
    // owner, and only app.attach_connect_account can set it.
    const strangerWrite = await rawAsMember(
      strangerId,
      (tx) =>
        tx`UPDATE public.profiles SET stripe_connect_account_id = 'acct_evil' WHERE id = ${hostId}::uuid RETURNING id`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    expect(strangerWrite).toBe("refused");

    const ownerWrite = await rawAsMember(
      hostId,
      (tx) =>
        tx`UPDATE public.profiles SET stripe_connect_account_id = 'acct_self' WHERE id = ${hostId}::uuid RETURNING id`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    expect(ownerWrite).toBe("refused");

    const readinessWrite = await rawAsMember(
      hostId,
      (tx) =>
        tx`UPDATE public.profiles SET stripe_charges_enabled = true, stripe_payouts_enabled = true WHERE id = ${hostId}::uuid RETURNING id`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    expect(readinessWrite).toBe("refused");

    const hostWrote = await rawAsMember(
      hostId,
      (tx) =>
        tx`UPDATE public.listings SET permit_number = 'OPTIONAL-NULLABLE' WHERE id = ${listingId}::uuid RETURNING permit_number`,
    );
    expect(hostWrote[0]?.permit_number).toBe("OPTIONAL-NULLABLE");
  });
});

describeDb("pooled connections do not leak identity", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("forgets app.user_id when the transaction ends", async () => {
    // set_config(..., is_local => true) is why this holds. Without it the next
    // request to borrow this backend would inherit the previous member.
    const memberId = id();
    await insertMember(memberId, `leak-${memberId}@stead.example`, "Leaky");

    const inside = await rawAsMember(
      memberId,
      (tx) => tx`SELECT app.current_user_id()::text AS uid`,
    );
    expect(inside[0]?.uid).toBe(memberId);

    const { appSql } = await getHarness();
    const after = await appSql`SELECT app.current_user_id()::text AS uid`;
    expect(after[0]?.uid).toBeNull();
  });
});

describeDb("refunds are readable by the booking's parties and writable by nobody", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function bookingWithRefund() {
    const hostId = id();
    const guestId = id();
    const stranger = id();
    const listingId = id();
    const bookingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertMember(stranger, `other-${stranger}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2029-01-01",
      checkOut: "2029-01-31",
      status: "expired",
      paymentIntentId: `pi_rls_${bookingId.slice(0, 10)}`,
    });

    const { owner } = await getHarness();
    // Written as the owner, because no client role can create one.
    await owner.execute(sql`
      INSERT INTO public.refunds (booking_id, amount_cents, reason, stripe_refund_id)
      VALUES (${bookingId}::uuid, 612000, 'expired', ${"re_rls_" + bookingId.slice(0, 10)})
    `);

    return { hostId, guestId, stranger, bookingId };
  }

  it("shows a refund to the guest and host, and to nobody else", async () => {
    const { hostId, guestId, stranger, bookingId } = await bookingWithRefund();
    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.refunds WHERE booking_id = ${bookingId}::uuid`);

    expect(await read(guestId)).toHaveLength(1);
    expect(await read(hostId)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("refuses a member writing their own refund", async () => {
    const { guestId, bookingId } = await bookingWithRefund();

    // The realistic abuse: a member inventing money back for themselves.
    // app_user holds no INSERT grant, so this is refused outright.
    const failure = await rawAsMember(guestId, (tx) => tx`
      INSERT INTO public.refunds (booking_id, amount_cents, reason)
      VALUES (${bookingId}::uuid, 999999, 'expired')
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });

  it("refuses a member editing or deleting a refund", async () => {
    const { guestId, bookingId } = await bookingWithRefund();

    const updated = await rawAsMember(guestId, (tx) => tx`
      UPDATE public.refunds SET amount_cents = 1 WHERE booking_id = ${bookingId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );
    const deleted = await rawAsMember(guestId, (tx) => tx`
      DELETE FROM public.refunds WHERE booking_id = ${bookingId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );

    expect(updated).toBe("refused");
    expect(deleted).toBe("refused");
  });

  it("refuses a member driving an escrow transition directly", async () => {
    const { guestId } = await bookingWithRefund();

    // The transitions are SECURITY DEFINER, but escrow_deposits itself carries
    // no UPDATE grant — so a member cannot release their own deposit.
    const failure = await rawAsMember(guestId, (tx) => tx`
      UPDATE public.escrow_deposits SET state = 'released'
    `).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
  });
});

describeDb("claims are visible to parties and the arbiter, writable by nobody", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function claimedStay() {
    const hostId = id();
    const guestId = id();
    const stranger = id();
    const arbiter = id();
    const listingId = id();
    const bookingId = id();
    const claimId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertMember(stranger, `other-${stranger}@stead.example`, "Stranger");
    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2029-03-01",
      checkOut: "2029-03-31",
      status: "completed",
    });

    const { owner } = await getHarness();
    await owner.execute(sql`
      INSERT INTO public.escrow_deposits (booking_id, amount_cents, state, method, window_closes_at)
      VALUES (${bookingId}::uuid, 30000, 'claimed', 'card_on_file', now() + interval '1 day')
    `);
    await owner.execute(sql`
      INSERT INTO public.claims (id, booking_id, filed_by, amount_cents, description, state)
      VALUES (${claimId}::uuid, ${bookingId}::uuid, ${hostId}::uuid, 10000, 'RLS probe', 'open')
    `);
    await owner.execute(sql`
      UPDATE public.profiles SET is_arbiter = true WHERE id = ${arbiter}::uuid
    `);

    return { hostId, guestId, stranger, arbiter, bookingId, claimId };
  }

  it("shows a claim to the guest, host and arbiter, and to nobody else", async () => {
    const { hostId, guestId, stranger, arbiter, claimId } = await claimedStay();
    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.claims WHERE id = ${claimId}::uuid`);

    expect(await read(guestId)).toHaveLength(1);
    expect(await read(hostId)).toHaveLength(1);
    expect(await read(arbiter)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("refuses a member writing or editing a claim directly", async () => {
    const { hostId, bookingId, claimId } = await claimedStay();

    const inserted = await rawAsMember(hostId, (tx) => tx`
      INSERT INTO public.claims (booking_id, filed_by, amount_cents, description)
      VALUES (${bookingId}::uuid, ${hostId}::uuid, 1, 'Invented')
    `).then(
      () => "allowed",
      () => "refused",
    );
    const updated = await rawAsMember(hostId, (tx) => tx`
      UPDATE public.claims SET state = 'resolved_host' WHERE id = ${claimId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );
    const deleted = await rawAsMember(hostId, (tx) => tx`
      DELETE FROM public.claims WHERE id = ${claimId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );

    expect(inserted).toBe("refused");
    expect(updated).toBe("refused");
    expect(deleted).toBe("refused");
  });

  it("lets a party attach evidence and hides it from a stranger", async () => {
    const { hostId, guestId, stranger, arbiter, claimId } = await claimedStay();

    const attached = (await rawAsMember(
      hostId,
      (tx) => tx`
        INSERT INTO public.claim_evidence (claim_id, uploaded_by, storage_path, note)
        VALUES (${claimId}::uuid, ${hostId}::uuid, 'claims/x/a.jpg', 'lamp')
        RETURNING id
      `,
    )) as { id: string }[];
    expect(attached).toHaveLength(1);

    const planted = await rawAsMember(stranger, (tx) => tx`
      INSERT INTO public.claim_evidence (claim_id, uploaded_by, storage_path)
      VALUES (${claimId}::uuid, ${stranger}::uuid, 'claims/x/evil.jpg')
    `).then(
      () => "allowed",
      () => "refused",
    );
    expect(planted).toBe("refused");

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.claim_evidence WHERE claim_id = ${claimId}::uuid`);
    expect(await read(guestId)).toHaveLength(1);
    expect(await read(arbiter)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
  });

  it("refuses a member marking themselves an arbiter", async () => {
    const member = id();
    await insertMember(member, `m-${member}@stead.example`, "Member");

    const failure = await rawAsMember(member, (tx) => tx`
      UPDATE public.profiles SET is_arbiter = true WHERE id = ${member}::uuid
    `).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).not.toBeNull();
  });
});

describeDb("reviews are public when published, drafts only the author", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function stayWithDraft() {
    const hostId = id();
    const guestId = id();
    const stranger = id();
    const listingId = id();
    const bookingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertMember(stranger, `other-${stranger}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2029-05-01",
      checkOut: "2029-05-31",
      status: "completed",
    });

    const reviewId = (
      (await rawAsMember(
        guestId,
        (tx) =>
          tx`SELECT app.submit_review(${bookingId}::uuid, 5, '{}'::text[], 'Draft body') AS id`,
      )) as { id: string }[]
    )[0]?.id;
    if (!reviewId) throw new Error("expected a draft review");

    return { hostId, guestId, stranger, bookingId, reviewId };
  }

  it("hides an unpublished review from the counterpart and a stranger", async () => {
    const { hostId, guestId, stranger, reviewId } = await stayWithDraft();
    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.reviews WHERE id = ${reviewId}::uuid`);

    expect(await read(guestId)).toHaveLength(1);
    expect(await read(hostId)).toHaveLength(0);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("shows a published review to anyone", async () => {
    const { hostId, guestId, stranger, bookingId, reviewId } = await stayWithDraft();
    await rawAsMember(
      hostId,
      (tx) => tx`SELECT app.submit_review(${bookingId}::uuid, 4, '{}'::text[], 'Also in')`,
    );

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.reviews WHERE id = ${reviewId}::uuid`);
    expect(await read(stranger)).toHaveLength(1);
    expect(await read(null)).toHaveLength(1);
    expect(await read(guestId)).toHaveLength(1);
  });

  it("refuses a member writing or publishing a review directly", async () => {
    const { guestId, bookingId, reviewId } = await stayWithDraft();

    const inserted = await rawAsMember(guestId, (tx) => tx`
      INSERT INTO public.reviews (booking_id, author_id, subject_id, direction, rating, body)
      VALUES (${bookingId}::uuid, ${guestId}::uuid, ${guestId}::uuid, 'guest_reviews_host', 1, 'Invented')
    `).then(
      () => "allowed",
      () => "refused",
    );
    const published = await rawAsMember(guestId, (tx) => tx`
      UPDATE public.reviews SET published_at = now() WHERE id = ${reviewId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );

    expect(inserted).toBe("refused");
    expect(published).toBe("refused");
  });
});

describeDb("messages are visible only to the two participants", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function thread() {
    const hostId = id();
    const guestId = id();
    const stranger = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertMember(stranger, `other-${stranger}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId });
    const inserted = (await rawAsMember(
      guestId,
      (tx) => tx`
        INSERT INTO public.messages (listing_id, sender_id, recipient_id, body)
        VALUES (${listingId}::uuid, ${guestId}::uuid, ${hostId}::uuid, 'Is the lemon tree still there?')
        RETURNING id
      `,
    )) as { id: string }[];
    const messageId = inserted[0]?.id;
    if (!messageId) throw new Error("expected a message");
    return { hostId, guestId, stranger, listingId, messageId };
  }

  it("shows a message to the guest and host, and to nobody else", async () => {
    const { hostId, guestId, stranger, messageId } = await thread();
    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.messages WHERE id = ${messageId}::uuid`);

    expect(await read(guestId)).toHaveLength(1);
    expect(await read(hostId)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);
  });

  it("lets a guest write the host before a booking exists", async () => {
    const { guestId, listingId } = await thread();
    const second = (await rawAsMember(
      guestId,
      (tx) => tx`
        INSERT INTO public.messages (listing_id, sender_id, recipient_id, body)
        VALUES (${listingId}::uuid, ${guestId}::uuid, (
          SELECT host_id FROM public.listings WHERE id = ${listingId}::uuid
        ), 'Second note')
        RETURNING id
      `,
    )) as { id: string }[];
    expect(second).toHaveLength(1);
  });

  it("lets a stranger inquire — they are a guest who has not booked yet", async () => {
    const { stranger, hostId, listingId, messageId } = await thread();
    const inquiry = (await rawAsMember(
      stranger,
      (tx) => tx`
        INSERT INTO public.messages (listing_id, sender_id, recipient_id, body)
        VALUES (${listingId}::uuid, ${stranger}::uuid, ${hostId}::uuid, 'Is August free?')
        RETURNING id
      `,
    )) as { id: string }[];
    expect(inquiry).toHaveLength(1);

    // Their own row is visible; the other guest's thread is not.
    const other = await rawAsMember(
      stranger,
      (tx) => tx`SELECT id FROM public.messages WHERE id = ${messageId}::uuid`,
    );
    expect(other).toHaveLength(0);
  });

  it("refuses a stranger writing as the host", async () => {
    const { stranger, guestId, listingId } = await thread();
    const impersonate = await rawAsMember(stranger, (tx) => tx`
      INSERT INTO public.messages (listing_id, sender_id, recipient_id, body)
      VALUES (${listingId}::uuid, ${stranger}::uuid, ${guestId}::uuid, 'I am not the host')
    `).then(
      () => "allowed",
      () => "refused",
    );
    expect(impersonate).toBe("refused");
  });

  it("refuses a member writing read_at directly", async () => {
    const { guestId, messageId } = await thread();
    const updated = await rawAsMember(guestId, (tx) => tx`
      UPDATE public.messages SET read_at = now() WHERE id = ${messageId}::uuid
    `).then(
      () => "allowed",
      () => "refused",
    );
    expect(updated).toBe("refused");
  });
});

describeDb("ops reads are gated by is_ops", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("returns nothing to a regular member and the rows to ops", async () => {
    const member = id();
    const ops = id();
    await insertMember(member, `member-${member}@stead.example`, "Member");
    await insertMember(ops, `ops-${ops}@stead.example`, "Ops");
    await asOwner(async (db) => {
      await db.execute(sql`UPDATE public.profiles SET is_ops = true WHERE id = ${ops}::uuid`);
      await db.execute(sql`
        INSERT INTO public.stripe_disputes (id, payment_intent_id, amount_cents, status)
        VALUES (${`dp_rls_${ops.slice(0, 8)}`}, 'pi_rls', 1000, 'needs_response')
      `);
    });

    const asRegular = (await rawAsMember(
      member,
      (tx) => tx`SELECT id FROM app.list_ops_disputes()`,
    )) as { id: string }[];
    const asOps = (await rawAsMember(
      ops,
      (tx) => tx`SELECT id FROM app.list_ops_disputes()`,
    )) as { id: string }[];
    expect(asRegular).toHaveLength(0);
    expect(asOps.some((row) => row.id.startsWith("dp_rls_"))).toBe(true);
  });
});

/**
 * Slice 8 — one fixture, every role. Guest A / guest B / host / arbiter / ops /
 * anonymous against the same booking, deposit, claim, payout, and message.
 * The earlier blocks prove individual policies; this one is the isolation matrix.
 */
describeDb("cross-role isolation matrix", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  async function matrix() {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const arbiter = id();
    const ops = id();
    const listingId = id();
    const bookingId = id();
    const claimId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await insertMember(ops, `ops-${ops}@stead.example`, "Ops");
    await insertListing({ id: listingId, hostId, title: "Matrix cottage" });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId: guestA,
      checkIn: "2032-01-01",
      checkOut: "2032-01-31",
      status: "completed",
      paymentIntentId: `pi_matrix_${bookingId.slice(0, 8)}`,
    });

    await asOwner(async (db) => {
      await db.execute(sql`UPDATE public.profiles SET is_arbiter = true WHERE id = ${arbiter}::uuid`);
      await db.execute(sql`UPDATE public.profiles SET is_ops = true WHERE id = ${ops}::uuid`);
      await db.execute(sql`
        INSERT INTO public.escrow_deposits (booking_id, amount_cents, state, method, window_closes_at)
        VALUES (${bookingId}::uuid, 30000, 'claimed', 'card_on_file', now() + interval '1 day')
      `);
      await db.execute(sql`
        INSERT INTO public.claims (id, booking_id, filed_by, amount_cents, description, state)
        VALUES (${claimId}::uuid, ${bookingId}::uuid, ${hostId}::uuid, 10000, 'Matrix claim', 'open')
      `);
      await db.execute(sql`
        INSERT INTO public.payouts (booking_id, host_id, amount_cents, state)
        VALUES (${bookingId}::uuid, ${hostId}::uuid, 600000, 'paid')
      `);
      await db.execute(sql`
        INSERT INTO public.refunds (booking_id, amount_cents, reason)
        VALUES (${bookingId}::uuid, 1000, 'dispute')
      `);
      await db.execute(sql`
        INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor)
        SELECT id, 'held', 'claimed', 'test:matrix' FROM public.escrow_deposits
         WHERE booking_id = ${bookingId}::uuid
      `);
    });

    const inserted = (await rawAsMember(
      guestA,
      (tx) => tx`
        INSERT INTO public.messages (listing_id, sender_id, recipient_id, body)
        VALUES (${listingId}::uuid, ${guestA}::uuid, ${hostId}::uuid, 'Matrix thread')
        RETURNING id
      `,
    )) as { id: string }[];
    const mid = inserted[0]?.id;
    if (!mid) throw new Error("expected a matrix message");

    return { hostId, guestA, guestB, arbiter, ops, listingId, bookingId, claimId, messageId: mid };
  }

  it("shows each row only to the roles that own it", async () => {
    const { hostId, guestA, guestB, arbiter, ops, bookingId, claimId, messageId } = await matrix();

    const count = async (viewer: string | null, sqlText: string) => {
      const rows = (await rawAsMember(viewer, (tx) => tx.unsafe(sqlText))) as { id: string }[];
      return rows.length;
    };

    const bookingSql = `SELECT id FROM public.bookings WHERE id = '${bookingId}'`;
    expect(await count(guestA, bookingSql)).toBe(1);
    expect(await count(hostId, bookingSql)).toBe(1);
    expect(await count(guestB, bookingSql)).toBe(0);
    expect(await count(ops, bookingSql)).toBe(0);
    expect(await count(null, bookingSql)).toBe(0);
    // This fixture has a claim on it, and 0013 lets an arbiter read a booking
    // for exactly that reason: they cannot resolve a claim whose dates they
    // cannot see. The claim-free case is asserted below, and it is still 0.
    expect(await count(arbiter, bookingSql)).toBe(1);

    const escrowSql = `SELECT id FROM public.escrow_deposits WHERE booking_id = '${bookingId}'`;
    expect(await count(guestA, escrowSql)).toBe(1);
    expect(await count(hostId, escrowSql)).toBe(1);
    expect(await count(arbiter, escrowSql)).toBe(1);
    expect(await count(guestB, escrowSql)).toBe(0);
    expect(await count(ops, escrowSql)).toBe(0);

    const auditSql = `SELECT id FROM public.escrow_audit WHERE actor = 'test:matrix'`;
    expect(await count(guestA, auditSql)).toBe(1);
    expect(await count(arbiter, auditSql)).toBe(1);
    expect(await count(guestB, auditSql)).toBe(0);

    const claimSql = `SELECT id FROM public.claims WHERE id = '${claimId}'`;
    expect(await count(guestA, claimSql)).toBe(1);
    expect(await count(hostId, claimSql)).toBe(1);
    expect(await count(arbiter, claimSql)).toBe(1);
    expect(await count(guestB, claimSql)).toBe(0);
    expect(await count(ops, claimSql)).toBe(0);

    const payoutSql = `SELECT id FROM public.payouts WHERE booking_id = '${bookingId}'`;
    expect(await count(hostId, payoutSql)).toBe(1);
    expect(await count(guestA, payoutSql)).toBe(0);
    expect(await count(guestB, payoutSql)).toBe(0);
    expect(await count(arbiter, payoutSql)).toBe(0);
    expect(await count(ops, payoutSql)).toBe(0);

    const refundSql = `SELECT id FROM public.refunds WHERE booking_id = '${bookingId}'`;
    expect(await count(guestA, refundSql)).toBe(1);
    expect(await count(hostId, refundSql)).toBe(1);
    expect(await count(guestB, refundSql)).toBe(0);
    expect(await count(ops, refundSql)).toBe(0);

    const messageSql = `SELECT id FROM public.messages WHERE id = '${messageId}'`;
    expect(await count(guestA, messageSql)).toBe(1);
    expect(await count(hostId, messageSql)).toBe(1);
    expect(await count(guestB, messageSql)).toBe(0);
    expect(await count(arbiter, messageSql)).toBe(0);
    expect(await count(ops, messageSql)).toBe(0);
  });

  /**
   * 0013 widened `bookings` and `listings` for arbiters. These probes hold the
   * widening to exactly what it was for: a booking an arbiter can read must
   * have a claim on it, and read is all they get. Issued as raw SQL over the
   * app_user connection, so it is Postgres refusing and not the query layer.
   */
  it("lets an arbiter read a booking only because a claim exists on it", async () => {
    const arbiter = id();
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const claimed = id();
    const clean = id();

    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await asOwner((db) =>
      db.execute(sql`UPDATE public.profiles SET is_arbiter = true WHERE id = ${arbiter}::uuid`),
    );
    // Paused, so no arbiter can reach it through the public listing policy.
    await insertListing({ id: listingId, hostId, title: "Arbiter probe", status: "paused" });
    await insertBooking({
      id: claimed,
      listingId,
      guestId,
      checkIn: "2033-01-01",
      checkOut: "2033-01-31",
      status: "completed",
    });
    await insertBooking({
      id: clean,
      listingId,
      guestId,
      checkIn: "2034-01-01",
      checkOut: "2034-01-31",
      status: "completed",
    });
    await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.claims (booking_id, filed_by, amount_cents, description, state)
        VALUES (${claimed}::uuid, ${hostId}::uuid, 10000, 'Probe claim', 'open')
      `),
    );

    const readable = async (viewer: string, bookingId: string) => {
      const rows = (await rawAsMember(
        viewer,
        (tx) => tx`SELECT id FROM public.bookings WHERE id = ${bookingId}::uuid`,
      )) as { id: string }[];
      return rows.length;
    };

    // The claim is the whole permission. Without one, the arbiter sees nothing.
    expect(await readable(arbiter, claimed)).toBe(1);
    expect(await readable(arbiter, clean)).toBe(0);

    // The paused listing comes with it, and only that one.
    const listings = (await rawAsMember(
      arbiter,
      (tx) => tx`SELECT id FROM public.listings WHERE id = ${listingId}::uuid`,
    )) as { id: string }[];
    expect(listings).toHaveLength(1);
  });

  it("gives an arbiter no way to write a booking or a listing", async () => {
    const arbiter = id();
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const bookingId = id();

    await insertMember(arbiter, `arb-${arbiter}@stead.example`, "Arbiter");
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await asOwner((db) =>
      db.execute(sql`UPDATE public.profiles SET is_arbiter = true WHERE id = ${arbiter}::uuid`),
    );
    await insertListing({ id: listingId, hostId, title: "Arbiter write probe" });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2035-01-01",
      checkOut: "2035-01-31",
      status: "completed",
    });
    await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.claims (booking_id, filed_by, amount_cents, description, state)
        VALUES (${bookingId}::uuid, ${hostId}::uuid, 10000, 'Write probe', 'open')
      `),
    );

    // Reading it changes nothing about writing it. `app_user` has no UPDATE
    // grant on bookings at all, and 0013 added no policy for one.
    const renamed = await rawAsMember(
      arbiter,
      (tx) => tx`UPDATE public.listings SET title = 'Seized' WHERE id = ${listingId}::uuid RETURNING id`,
    ).then(
      (rows) => (rows as unknown as { id: string }[]).length,
      () => "refused" as const,
    );
    expect(renamed === 0 || renamed === "refused").toBe(true);

    const deleted = await rawAsMember(
      arbiter,
      (tx) => tx`DELETE FROM public.bookings WHERE id = ${bookingId}::uuid RETURNING id`,
    ).then(
      (rows) => (rows as unknown as { id: string }[]).length,
      () => "refused" as const,
    );
    expect(deleted === 0 || deleted === "refused").toBe(true);

    const [row] = (await asOwner((db) =>
      db.execute(sql`SELECT title FROM public.listings WHERE id = ${listingId}::uuid`),
    )) as unknown as { title: string }[];
    expect(row?.title).toBe("Arbiter write probe");
  });

  it("does not let ops or the arbiter grant themselves the other flag", async () => {
    const { arbiter, ops } = await matrix();

    const arbiterOps = await rawAsMember(
      arbiter,
      (tx) => tx`UPDATE public.profiles SET is_ops = true WHERE id = ${arbiter}::uuid`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    const opsArbiter = await rawAsMember(
      ops,
      (tx) => tx`UPDATE public.profiles SET is_arbiter = true WHERE id = ${ops}::uuid`,
    ).then(
      () => "allowed",
      () => "refused",
    );
    expect(arbiterOps).toBe("refused");
    expect(opsArbiter).toBe("refused");
  });
});

describeDb("HM-01: listing_scans is owner-read, capturing-insert only", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  const DOOR = { lat: 42.2529, lng: -73.791 };

  async function confirmedListing(hostId: string): Promise<string> {
    const listingId = id();
    await insertListing({ id: listingId, hostId, title: "Scan RLS cottage", status: "draft" });
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
      );
    });
    return listingId;
  }

  const insertScan = (viewer: string | null, listingId: string, hostId: string, state = "capturing") =>
    rawAsMember(
      viewer,
      (tx) => tx`
        INSERT INTO public.listing_scans (
          listing_id, host_id, state, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng
        ) VALUES (
          ${listingId}::uuid, ${hostId}::uuid, ${state}::public.scan_state, 1,
          35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng}
        ) RETURNING id
      `,
    );

  it("the owner can start a capture; nobody else can, and no other state can be inserted", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const listingId = await confirmedListing(hostId);

    const mine = await insertScan(hostId, listingId, hostId);
    expect(mine).toHaveLength(1);

    // Another host: neither as themselves nor by forging the owner's host_id.
    await expect(insertScan(otherHost, listingId, otherHost)).rejects.toThrow(/row-level security/);
    await expect(insertScan(otherHost, listingId, hostId)).rejects.toThrow(/row-level security/);
    await expect(insertScan(null, listingId, hostId)).rejects.toThrow(/row-level security/);

    // The owner cannot insert a verdict.
    await expect(insertScan(hostId, listingId, hostId, "verified")).rejects.toThrow(/row-level security/);
    await expect(insertScan(hostId, listingId, hostId, "uploaded")).rejects.toThrow(/row-level security/);
  });

  it("no capture before the front door is confirmed", async () => {
    const hostId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    const listingId = id();
    await insertListing({ id: listingId, hostId, title: "Unconfirmed cottage", status: "draft" });
    await expect(insertScan(hostId, listingId, hostId)).rejects.toThrow(/row-level security/);
  });

  it("scan rows are visible to their host only, and app_user cannot change state or delete", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const listingId = await confirmedListing(hostId);
    const [row] = await insertScan(hostId, listingId, hostId);
    const scanId = (row as { id: string }).id;

    const read = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.listing_scans WHERE id = ${scanId}::uuid`);
    expect(await read(hostId)).toHaveLength(1);
    expect(await read(otherHost)).toHaveLength(0);
    expect(await read(null)).toHaveLength(0);

    // No UPDATE or DELETE grant at all: even the owner is refused by Postgres.
    await expect(
      rawAsMember(hostId, (tx) => tx`UPDATE public.listing_scans SET state = 'verified' WHERE id = ${scanId}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rawAsMember(hostId, (tx) => tx`UPDATE public.listing_scans SET verified_at = now() WHERE id = ${scanId}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rawAsMember(hostId, (tx) => tx`DELETE FROM public.listing_scans WHERE id = ${scanId}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });

  it("a confirmation cannot exist without a point, and moving the point clears it", async () => {
    const hostId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    const listingId = id();
    await insertListing({ id: listingId, hostId, title: "Door cottage", status: "draft" });

    await expect(
      rawAsMember(hostId, (tx) => tx`UPDATE public.listings SET coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`),
    ).rejects.toThrow(/listings_confirmed_point_needs_lat_lng/);

    await rawAsMember(
      hostId,
      (tx) =>
        tx`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
    );
    const confirmed = await rawAsMember(
      hostId,
      (tx) => tx`SELECT coordinates_confirmed_at FROM public.listings WHERE id = ${listingId}::uuid`,
    );
    expect((confirmed[0] as { coordinates_confirmed_at: Date | null }).coordinates_confirmed_at).not.toBeNull();

    await rawAsMember(hostId, (tx) => tx`UPDATE public.listings SET lat = ${DOOR.lat + 0.001} WHERE id = ${listingId}::uuid`);
    const cleared = await rawAsMember(
      hostId,
      (tx) => tx`SELECT coordinates_confirmed_at FROM public.listings WHERE id = ${listingId}::uuid`,
    );
    expect((cleared[0] as { coordinates_confirmed_at: Date | null }).coordinates_confirmed_at).toBeNull();
  });
});

describeDb("HM-02: artifacts are owner-read, samples are nobody's, completion is host-only and once", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  const DOOR = { lat: 42.2529, lng: -73.791 };

  async function capturing(hostId: string): Promise<{ listingId: string; scanId: string }> {
    const listingId = id();
    await insertListing({ id: listingId, hostId, title: "Upload RLS cottage", status: "draft" });
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
      );
    });
    const [row] = await rawAsMember(
      hostId,
      (tx) => tx`
        INSERT INTO public.listing_scans (
          listing_id, host_id, state, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng
        ) VALUES (
          ${listingId}::uuid, ${hostId}::uuid, 'capturing', 1, 35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng}
        ) RETURNING id
      `,
    );
    return { listingId, scanId: (row as { id: string }).id };
  }

  const complete = (viewer: string | null, scanId: string, ok = true) =>
    rawAsMember(
      viewer,
      (tx) => tx`
        SELECT app.complete_scan_upload(
          ${scanId}::uuid, ${ok}, ${ok ? null : "location_mismatch"}, '2026-09-14'::date,
          '{"sampleCount":1}'::jsonb,
          ${tx.json([{ kind: "video", object_key: `k/${scanId}/video.mp4`, content_type: "video/mp4", size_bytes: 10 }])}::jsonb,
          ${tx.json([{ seq: 0, t_ms: 0, lat: DOOR.lat, lng: DOOR.lng, accuracy_m: 5, accurate: true, distance_m: 0 }])}::jsonb
        ) AS done
      `,
    );

  it("only the host can complete, and only once", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const { scanId } = await capturing(hostId);

    expect((await complete(otherHost, scanId))[0]).toEqual({ done: false });
    expect((await complete(null, scanId))[0]).toEqual({ done: false });
    const stateAfterStranger = await rawAsMember(hostId, (tx) => tx`SELECT state::text FROM public.listing_scans WHERE id = ${scanId}::uuid`);
    expect((stateAfterStranger[0] as { state: string }).state).toBe("capturing");

    expect((await complete(hostId, scanId))[0]).toEqual({ done: true });
    expect((await complete(hostId, scanId))[0]).toEqual({ done: false });
    const stateAfter = await rawAsMember(hostId, (tx) => tx`SELECT state::text, reason FROM public.listing_scans WHERE id = ${scanId}::uuid`);
    expect(stateAfter[0]).toEqual({ state: "uploaded", reason: null });
  });

  it("a rejection needs a reason and an acceptance refuses one", async () => {
    const hostId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    const { scanId } = await capturing(hostId);
    await expect(
      rawAsMember(hostId, (tx) => tx`SELECT app.complete_scan_upload(${scanId}::uuid, false, NULL, '2026-09-14'::date, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)`),
    ).rejects.toThrow(/needs a reason/);
    await expect(
      rawAsMember(hostId, (tx) => tx`SELECT app.complete_scan_upload(${scanId}::uuid, true, 'x', '2026-09-14'::date, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)`),
    ).rejects.toThrow(/carries no reason/);
    expect((await complete(hostId, scanId, false))[0]).toEqual({ done: true });
    const after = await rawAsMember(hostId, (tx) => tx`SELECT state::text, reason FROM public.listing_scans WHERE id = ${scanId}::uuid`);
    expect(after[0]).toEqual({ state: "rejected", reason: "location_mismatch" });
  });

  it("artifacts are readable by their host only; samples by no member; neither is writable", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const { scanId } = await capturing(hostId);
    expect((await complete(hostId, scanId))[0]).toEqual({ done: true });

    const artifacts = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT id FROM public.scan_artifacts WHERE scan_id = ${scanId}::uuid`);
    expect(await artifacts(hostId)).toHaveLength(1);
    expect(await artifacts(otherHost)).toHaveLength(0);
    expect(await artifacts(null)).toHaveLength(0);

    for (const viewer of [hostId, otherHost, null]) {
      await expect(
        rawAsMember(viewer, (tx) => tx`SELECT seq FROM public.scan_geo_samples WHERE scan_id = ${scanId}::uuid`),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      rawAsMember(hostId, (tx) => tx`INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes) VALUES (${scanId}::uuid, 'splat', 'x', 'y', 1)`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rawAsMember(hostId, (tx) => tx`DELETE FROM public.scan_artifacts WHERE scan_id = ${scanId}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rawAsMember(hostId, (tx) => tx`INSERT INTO public.scan_geo_samples (scan_id, seq, t_ms, lat, lng, accuracy_m, accurate, distance_m) VALUES (${scanId}::uuid, 99, 0, 0, 0, 1, true, 0)`),
    ).rejects.toThrow(/permission denied/);
  });
});


describeDb("HM-03: job transitions belong to the functions; members cannot claim, finish, retry another's scan or touch the job columns", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  const DOOR = { lat: 42.2529, lng: -73.791 };

  /** An uploaded package, as HM-02 leaves it. Owner writes, because members cannot. */
  async function uploaded(hostId: string, overrides: { state?: string; attempt?: number; claimedAt?: string | null } = {}) {
    const listingId = id();
    const scanId = id();
    const prefix = `listings/${listingId}/scans/${scanId}/`;
    await insertListing({ id: listingId, hostId, title: "Job RLS cottage", status: "draft" });
    await asOwner(async (db) => {
      await db.execute(sql`
        INSERT INTO public.listing_scans (
          id, listing_id, host_id, state, reason, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng, captured_on, completed_at, attempt, claimed_at
        ) VALUES (
          ${scanId}::uuid, ${listingId}::uuid, ${hostId}::uuid, ${overrides.state ?? "uploaded"}::public.scan_state,
          ${overrides.state === "failed" ? "reconstruction_failed" : null}, 1,
          35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng}, '2026-09-14'::date, now(),
          ${overrides.attempt ?? 0}, ${overrides.claimedAt ?? null}::timestamptz
        )
      `);
      await db.execute(sql`
        INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes) VALUES
          (${scanId}::uuid, 'video', ${`${prefix}video.mp4`}, 'video/mp4', 1000),
          (${scanId}::uuid, 'attestation', ${`${prefix}attestation.json`}, 'application/json', 100),
          (${scanId}::uuid, 'notes', ${`${prefix}notes.json`}, 'application/json', 50)
      `);
    });
    return { listingId, scanId, prefix };
  }

  const stateOf = async (viewer: string, scanId: string) => {
    const rows = await rawAsMember(viewer, (tx) => tx`SELECT state::text, attempt, reason FROM public.listing_scans WHERE id = ${scanId}::uuid`);
    return rows[0] as { state: string; attempt: number; reason: string | null } | undefined;
  };

  /** Claim as the worker does (no member) until this scan comes out; other suites leave packages behind. */
  async function claimUntil(scanId: string): Promise<number> {
    for (let i = 0; i < 50; i += 1) {
      const rows = (await rawAsMember(null, (tx) => tx`SELECT scan_id, attempt FROM app.claim_next_scan_job('rls-probe')`)) as {
        scan_id: string;
        attempt: number;
      }[];
      if (rows.length === 0) throw new Error("queue empty before the probe's scan was claimed");
      if (rows[0]?.scan_id === scanId) return rows[0].attempt;
    }
    throw new Error("probe's scan never came up");
  }

  it("no member can write the job columns or move the state directly", async () => {
    const hostId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    const { scanId } = await uploaded(hostId);
    for (const statement of [
      (tx: postgres.TransactionSql) => tx`UPDATE public.listing_scans SET attempt = 9 WHERE id = ${scanId}::uuid`,
      (tx: postgres.TransactionSql) => tx`UPDATE public.listing_scans SET claimed_at = now(), worker_id = 'me' WHERE id = ${scanId}::uuid`,
      (tx: postgres.TransactionSql) => tx`UPDATE public.listing_scans SET state = 'reconstructing' WHERE id = ${scanId}::uuid`,
      (tx: postgres.TransactionSql) => tx`UPDATE public.listing_scans SET state = 'needs_mask' WHERE id = ${scanId}::uuid`,
      (tx: postgres.TransactionSql) => tx`UPDATE public.listing_scans SET state = 'failed', reason = 'reconstruction_failed' WHERE id = ${scanId}::uuid`,
    ]) {
      await expect(rawAsMember(hostId, statement)).rejects.toThrow(/permission denied/);
    }
    expect(await stateOf(hostId, scanId)).toEqual({ state: "uploaded", attempt: 0, reason: null });
  });

  it("finish refuses a stale attempt and a key outside the prefix, then records only under the prefix", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const { scanId, prefix } = await uploaded(hostId);
    const attempt = await claimUntil(scanId);
    expect(attempt).toBe(1);
    expect(await stateOf(hostId, scanId)).toMatchObject({ state: "reconstructing", attempt: 1 });

    const good = [
      { kind: "cameras", object_key: `${prefix}cameras.json`, content_type: "application/json", size_bytes: 1 },
      { kind: "splat", object_key: `${prefix}splat.ply`, content_type: "application/octet-stream", size_bytes: 1 },
    ];
    const finish = (viewer: string | null, at: number, artifacts: postgres.JSONValue) =>
      rawAsMember(viewer, (tx) => tx`SELECT state FROM app.finish_scan_job(${scanId}::uuid, ${at}, 'needs_mask', NULL, ${tx.json(artifacts)}::jsonb)`);

    // A stale attempt writes nothing, whoever calls.
    expect(await finish(null, 2, good)).toHaveLength(0);
    expect(await finish(hostId, 2, good)).toHaveLength(0);
    expect(await stateOf(hostId, scanId)).toMatchObject({ state: "reconstructing", attempt: 1 });

    await expect(
      finish(null, 1, [...good, { kind: "stills", object_key: "listings/x/scans/y/stills/00.jpg", content_type: "image/jpeg", size_bytes: 1 }]),
    ).rejects.toThrow(/outside the scan prefix/);
    await expect(
      finish(null, 1, [...good, { kind: "video", object_key: `${prefix}video.mp4`, content_type: "video/mp4", size_bytes: 1 }]),
    ).rejects.toThrow(/outside the scan prefix|may not record/);
    await expect(finish(null, 1, good.slice(0, 1))).rejects.toThrow(/needs a splat/);
    expect(await stateOf(hostId, scanId)).toMatchObject({ state: "reconstructing", attempt: 1 });

    const rows = await finish(null, 1, good);
    expect(rows).toEqual([{ state: "needs_mask" }]);
    expect(await stateOf(hostId, scanId)).toEqual({ state: "needs_mask", attempt: 1, reason: null });
    // Recorded pointers are the host's to read and nobody's to write.
    const artifacts = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT kind::text FROM public.scan_artifacts WHERE scan_id = ${scanId}::uuid AND kind IN ('cameras', 'splat')`);
    expect(await artifacts(hostId)).toHaveLength(2);
    expect(await artifacts(otherHost)).toHaveLength(0);
    expect(await artifacts(null)).toHaveLength(0);
    // Done is done: the same attempt again returns nothing.
    expect(await finish(null, 1, good)).toHaveLength(0);
  });

  it("retry is the host's alone, from failed only, and capped", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const { scanId } = await uploaded(hostId, { state: "failed", attempt: 1 });
    const retry = (viewer: string | null, max = 3) =>
      rawAsMember(viewer, (tx) => tx`SELECT app.retry_scan_reconstruction(${scanId}::uuid, ${max}) AS ok`);

    expect((await retry(otherHost))[0]).toEqual({ ok: false });
    expect((await retry(null))[0]).toEqual({ ok: false });
    expect(await stateOf(hostId, scanId)).toMatchObject({ state: "failed", attempt: 1 });
    expect((await retry(hostId, 1))[0]).toEqual({ ok: false }); // cap already spent
    expect((await retry(hostId))[0]).toEqual({ ok: true });
    expect(await stateOf(hostId, scanId)).toEqual({ state: "uploaded", attempt: 1, reason: null });
    expect((await retry(hostId))[0]).toEqual({ ok: false }); // not failed any more
  });

  it("release moves only claims older than the window, and scan_notice answers only its host", async () => {
    const hostId = id();
    const otherHost = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(otherHost, `host-${otherHost}@stead.example`, "Other host", true);
    const old = new Date(Date.now() - 7 * 3600_000).toISOString();
    const recent = new Date(Date.now() - 600_000).toISOString();
    const dead = await uploaded(hostId, { state: "reconstructing", attempt: 1, claimedAt: old });
    const spent = await uploaded(hostId, { state: "reconstructing", attempt: 3, claimedAt: old });
    const alive = await uploaded(hostId, { state: "reconstructing", attempt: 1, claimedAt: recent });

    const moved = (await rawAsMember(
      null,
      (tx) => tx`SELECT scan_id, state FROM app.release_stale_scan_jobs(interval '6 hours', 3) ORDER BY scan_id`,
    )) as { scan_id: string; state: string }[];
    const mine = moved.filter((m) => [dead.scanId, spent.scanId, alive.scanId].includes(m.scan_id));
    expect(mine.sort((a, b) => a.scan_id.localeCompare(b.scan_id))).toEqual(
      [
        { scan_id: dead.scanId, state: "uploaded" },
        { scan_id: spent.scanId, state: "failed" },
      ].sort((a, b) => a.scan_id.localeCompare(b.scan_id)),
    );
    expect(await stateOf(hostId, dead.scanId)).toEqual({ state: "uploaded", attempt: 1, reason: null });
    expect(await stateOf(hostId, spent.scanId)).toEqual({ state: "failed", attempt: 3, reason: "reconstruction_failed" });
    expect(await stateOf(hostId, alive.scanId)).toMatchObject({ state: "reconstructing", attempt: 1 });

    const notice = (viewer: string | null) =>
      rawAsMember(viewer, (tx) => tx`SELECT host_email FROM app.scan_notice(${spent.scanId}::uuid)`);
    expect(await notice(hostId)).toEqual([{ host_email: `host-${hostId}@stead.example` }]);
    expect(await notice(otherHost)).toHaveLength(0);
    expect(await notice(null)).toHaveLength(0);
  });
});
