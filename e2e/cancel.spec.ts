/**
 * Slice 8 — cancel-with-refund. Flexible policy, more than 24h before
 * check-in, mock payment intent so Stripe is not called.
 */
import { expect, test } from "@playwright/test";
import { confirmBooking, ensureDb, isoDay, seedBookableParty } from "./helpers/party";

test.describe("cancel with refund", () => {
  test("guest cancel writes a refund and releases the deposit", async ({ request }) => {
    await ensureDb();
    const { listingId, cookie } = await seedBookableParty("Cancel cottage");

    const created = await request.post("/api/bookings", {
      headers: { cookie, "content-type": "application/json" },
      data: {
        listingId,
        checkIn: isoDay(45),
        checkOut: isoDay(75),
        guests: 2,
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = (await created.json()) as {
      bookingId: string;
      quote: { guest_total_cents: number; deposit_cents: number };
    };
    await confirmBooking(body.bookingId);

    const preview = await request.get(`/api/trips/${body.bookingId}/cancellation`, {
      headers: { cookie },
    });
    expect(preview.status()).toBe(200);
    const quote = (await preview.json()) as {
      canCancel: boolean;
      refundCents: number;
      depositReleasedCents: number;
    };
    expect(quote.canCancel).toBe(true);
    expect(quote.refundCents).toBe(body.quote.guest_total_cents);
    expect(quote.depositReleasedCents).toBe(body.quote.deposit_cents);

    const canceled = await request.post(`/api/trips/${body.bookingId}/cancel`, {
      headers: { cookie },
    });
    expect(canceled.status(), await canceled.text()).toBe(200);
    const result = (await canceled.json()) as {
      ok: boolean;
      status: string;
      refundCents: number;
      depositReleased: boolean;
    };
    expect(result.ok).toBe(true);
    expect(result.status).toBe("canceled_by_guest");
    expect(result.refundCents).toBe(body.quote.guest_total_cents);
    expect(result.depositReleased).toBe(true);

    const trip = await request.get(`/api/trips/${body.bookingId}`, { headers: { cookie } });
    const detail = (await trip.json()) as {
      status: string;
      escrow: { state: string } | null;
      cancellation: { canCancel: boolean };
    };
    expect(detail.status).toBe("canceled_by_guest");
    expect(detail.escrow?.state).toBe("released");
    expect(detail.cancellation.canCancel).toBe(false);
  });
});
