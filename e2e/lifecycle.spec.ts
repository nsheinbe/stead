/**
 * Slice 8 — book → check-in → checkout → deposit release.
 *
 * Hits the running Hono app (mock Stripe). Check-in / checkout / release are
 * the same cron endpoints production uses; dates are moved into the past so
 * listing-local time has elapsed. Live Stripe is gated in stripe.live.spec.ts.
 */
import { expect, test } from "@playwright/test";
import {
  backdateStay,
  closeClaimWindow,
  confirmBooking,
  cronHeaders,
  ensureDb,
  isoDay,
  seedBookableParty,
} from "./helpers/party";

test.describe("stay lifecycle", () => {
  test("book → check-in → checkout → deposit release", async ({ request }) => {
    await ensureDb();
    const { listingId, cookie } = await seedBookableParty("Lifecycle cottage");

    const created = await request.post("/api/bookings", {
      headers: { cookie, "content-type": "application/json" },
      data: {
        listingId,
        checkIn: isoDay(60),
        checkOut: isoDay(90),
        guests: 2,
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = (await created.json()) as {
      bookingId: string;
      mockPayment: boolean;
      quote: { guest_total_cents: number; deposit_cents: number };
    };
    expect(body.mockPayment).toBe(true);
    expect(body.quote.deposit_cents).toBeGreaterThan(0);

    await confirmBooking(body.bookingId);
    await backdateStay(body.bookingId);

    const checkIn = await request.post("/api/cron/check-in", { headers: cronHeaders() });
    expect(checkIn.status(), await checkIn.text()).toBe(200);
    expect(((await checkIn.json()) as { held: number }).held).toBeGreaterThanOrEqual(1);

    const afterCheckIn = await request.get(`/api/trips/${body.bookingId}`, { headers: { cookie } });
    expect(afterCheckIn.status()).toBe(200);
    const heldTrip = (await afterCheckIn.json()) as {
      status: string;
      escrow: { state: string } | null;
    };
    expect(heldTrip.status).toBe("checked_in");
    expect(heldTrip.escrow?.state).toBe("held");

    const checkOut = await request.post("/api/cron/check-out", { headers: cronHeaders() });
    expect(checkOut.status(), await checkOut.text()).toBe(200);
    expect(((await checkOut.json()) as { opened: number }).opened).toBeGreaterThanOrEqual(1);

    const afterCheckOut = await request.get(`/api/trips/${body.bookingId}`, { headers: { cookie } });
    const windowed = (await afterCheckOut.json()) as {
      status: string;
      escrow: { state: string } | null;
    };
    expect(windowed.status).toBe("completed");
    expect(windowed.escrow?.state).toBe("claim_window");

    await closeClaimWindow(body.bookingId);
    const release = await request.post("/api/cron/release-deposits", { headers: cronHeaders() });
    expect(release.status(), await release.text()).toBe(200);
    expect(((await release.json()) as { released: number }).released).toBeGreaterThanOrEqual(1);

    const done = await request.get(`/api/trips/${body.bookingId}`, { headers: { cookie } });
    const released = (await done.json()) as {
      status: string;
      escrow: { state: string; releasedAt: string | null; timeline: { toState: string }[] } | null;
    };
    expect(released.status).toBe("completed");
    expect(released.escrow?.state).toBe("released");
    expect(released.escrow?.releasedAt).toBeTruthy();
    expect(released.escrow?.timeline.map((step) => step.toState)).toEqual(
      expect.arrayContaining(["held", "claim_window", "released"]),
    );
  });
});
