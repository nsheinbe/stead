import { afterAll, describe, expect, it } from "vitest";
import {
  asGuest,
  closeTestPool,
  databaseUrl,
  getTestPool,
  insertListing,
  insertUser,
} from "./helpers/db";

const describeDb = databaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("bookings RLS", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("guest A cannot read guest B's booking", async () => {
    const pool = await getTestPool();
    const hostId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005";
    const guestA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0008";
    const guestB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0009";
    const listingId = "cccccccc-cccc-cccc-cccc-cccccccc0005";

    await insertUser(pool, hostId, "host-rls@stead.example", "Host", true);
    await insertUser(pool, guestA, "guest-a-rls@stead.example", "Guest A");
    await insertUser(pool, guestB, "guest-b-rls@stead.example", "Guest B");
    await insertListing(pool, { id: listingId, hostId, title: "RLS cottage" });

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO public.bookings (
         listing_id, guest_id, check_in, check_out, guests, nights,
         nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
         deposit_cents, cancellation_policy, status
       ) VALUES ($1, $2, '2027-01-08', '2027-01-11', 2, 3, 20000, 60000, 1200, 61200, 30000, 'moderate', 'confirmed')
       RETURNING id`,
      [listingId, guestA],
    );
    const bookingId = inserted.rows[0]?.id;
    expect(bookingId).toBeTruthy();

    const asA = await asGuest(pool, guestA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM public.bookings WHERE id = $1",
        [bookingId],
      );
      return rows;
    });
    expect(asA).toHaveLength(1);

    const asB = await asGuest(pool, guestB, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM public.bookings WHERE id = $1",
        [bookingId],
      );
      return rows;
    });
    expect(asB).toHaveLength(0);

    const writes = await asGuest(pool, guestA, async (client) => {
      try {
        await client.query("UPDATE public.bookings SET status = 'canceled_by_guest' WHERE id = $1", [
          bookingId,
        ]);
        return "updated";
      } catch (err) {
        return err instanceof Error ? err.message : "denied";
      }
    });
    expect(writes).not.toBe("updated");
  });
});
