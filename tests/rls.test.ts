/**
 * Adversarial RLS suite.
 *
 * These probes talk to Postgres directly as app_user, bypassing every line of
 * query code, so what they assert is what the database enforces. If someone
 * deletes a WHERE clause in server/queries tomorrow, tests/authorization.test.ts
 * goes red; if someone deletes a policy, this file does.
 */
import { afterAll, describe, expect, it } from "vitest";
import { assertTenantRole, describeRole, PrivilegedRoleError } from "../server/db/client";
import {
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
            nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
            deposit_cents, cancellation_policy, status
          ) VALUES (
            ${listingId}::uuid, ${guestId}::uuid, '2027-09-01', '2027-10-01', 2, 30,
            20000, 600000, 12000, 612000, 30000, 'moderate', 'pending_payment'
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

    const profileTouched = await rawAsMember(
      strangerId,
      (tx) =>
        tx`UPDATE public.profiles SET stripe_connect_account_id = 'acct_evil' WHERE id = ${hostId}::uuid RETURNING id`,
    );
    expect(profileTouched).toHaveLength(0);

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
