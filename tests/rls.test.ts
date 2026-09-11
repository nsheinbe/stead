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
    expect(await count(arbiter, bookingSql)).toBe(0);
    expect(await count(ops, bookingSql)).toBe(0);
    expect(await count(null, bookingSql)).toBe(0);

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
