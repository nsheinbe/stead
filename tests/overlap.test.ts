import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, databaseUrl, getTestPool, id, insertListing, insertUser } from "./helpers/db";

const describeDb = databaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("bookings exclusion constraint", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a second overlapping pending_payment on the same listing", async () => {
    const pool = await getTestPool();
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertUser(pool, hostId, "host-overlap@stead.example", "Host", true);
    await insertUser(pool, guestA, "guest-a-overlap@stead.example", "Guest A");
    await insertUser(pool, guestB, "guest-b-overlap@stead.example", "Guest B");
    await insertListing(pool, { id: listingId, hostId, title: "Overlap cottage" });

    const insert = `
      INSERT INTO public.bookings (
        listing_id, guest_id, check_in, check_out, guests, nights,
        nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
        deposit_cents, cancellation_policy, status
      ) VALUES ($1, $2, $3, $4, 2, 3, 20000, 60000, 1200, 61200, 30000, 'moderate', 'pending_payment')
    `;

    await pool.query(insert, [listingId, guestA, "2026-10-01", "2026-10-04"]);

    await expect(pool.query(insert, [listingId, guestB, "2026-10-03", "2026-10-06"])).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("allows a back-to-back stay that shares only the checkout morning", async () => {
    const pool = await getTestPool();
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertUser(pool, hostId, "host-adjacent@stead.example", "Host", true);
    await insertUser(pool, guestA, "guest-a-adj@stead.example", "Guest A");
    await insertUser(pool, guestB, "guest-b-adj@stead.example", "Guest B");
    await insertListing(pool, { id: listingId, hostId, title: "Adjacent cottage" });

    const insert = `
      INSERT INTO public.bookings (
        listing_id, guest_id, check_in, check_out, guests, nights,
        nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
        deposit_cents, cancellation_policy, status
      ) VALUES ($1, $2, $3, $4, 2, 2, 20000, 40000, 800, 40800, 30000, 'moderate', 'pending_payment')
    `;

    await pool.query(insert, [listingId, guestA, "2026-11-01", "2026-11-03"]);
    const second = await pool.query(insert + " RETURNING id", [listingId, guestB, "2026-11-03", "2026-11-05"]);
    expect(second.rowCount).toBe(1);
  });

  it("frees dates once the first hold is expired", async () => {
    const pool = await getTestPool();
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertUser(pool, hostId, "host-free@stead.example", "Host", true);
    await insertUser(pool, guestA, "guest-a-free@stead.example", "Guest A");
    await insertUser(pool, guestB, "guest-b-free@stead.example", "Guest B");
    await insertListing(pool, { id: listingId, hostId, title: "Freed cottage" });

    const first = await pool.query<{ id: string }>(
      `INSERT INTO public.bookings (
         listing_id, guest_id, check_in, check_out, guests, nights,
         nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
         deposit_cents, cancellation_policy, status
       ) VALUES ($1, $2, '2026-12-01', '2026-12-04', 2, 3, 20000, 60000, 1200, 61200, 30000, 'moderate', 'pending_payment')
       RETURNING id`,
      [listingId, guestA],
    );
    await pool.query(`UPDATE public.bookings SET status = 'expired' WHERE id = $1`, [first.rows[0]?.id]);

    const second = await pool.query(
      `INSERT INTO public.bookings (
         listing_id, guest_id, check_in, check_out, guests, nights,
         nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
         deposit_cents, cancellation_policy, status
       ) VALUES ($1, $2, '2026-12-01', '2026-12-04', 2, 3, 20000, 60000, 1200, 61200, 30000, 'moderate', 'pending_payment')`,
      [listingId, guestB],
    );
    expect(second.rowCount).toBe(1);
  });
});
