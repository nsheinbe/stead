/**
 * Idempotent Stripe webhook, per BUILD_PROMPT §7. Insert the event id first and
 * skip if it is already there; payment_intent.succeeded confirms the booking.
 * Disputes and account.updated are acknowledged here and handled in later slices.
 *
 * Stripe is not a member, so this runs with no app.user_id. Both operations it
 * performs are SECURITY DEFINER functions — app_user cannot read stripe_events
 * or update a booking directly.
 */
import { Hono } from "hono";
import type Stripe from "stripe";
import { handleStripeEvent } from "../lib/stripeWebhook";
import { getStripe, stripeConfigured } from "../lib/stripe";
import { tenantQuery, type AppEnv } from "../lib/http";
import { claimStripeEvent, confirmBookingForPaymentIntent } from "../queries/bookings";
import { findExpiredBookingForPaymentIntent, refundExpiredBooking } from "../queries/escrow";

export const stripeRoutes = new Hono<AppEnv>();

stripeRoutes.post("/webhook", async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !stripeConfigured()) {
    return c.text("Stripe is not configured on this deployment", 500);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) return c.text("Missing stripe-signature header", 400);

  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch {
    return c.text("Signature verification failed", 400);
  }

  const result = await tenantQuery(c, (tx) =>
    handleStripeEvent(
      {
        id: event.id,
        type: event.type,
        data: {
          object: { id: "id" in event.data.object ? String(event.data.object.id) : undefined },
        },
      },
      {
        claimEvent: (id, type) => claimStripeEvent(tx, id, type),
        confirmBookingByPaymentIntent: (paymentIntentId) =>
          confirmBookingForPaymentIntent(tx, paymentIntentId),
        findExpiredBooking: (paymentIntentId) =>
          findExpiredBookingForPaymentIntent(tx, paymentIntentId),
      },
    ),
  );

  // The guest paid for a booking the TTL had already expired. The refund is an
  // outbound call, so it happens here rather than inside the transaction above.
  let refunded = false;
  const due = result.refundDue;
  if (due) {
    try {
      const refund = await getStripe().refunds.create({
        payment_intent: due.paymentIntentId,
        amount: due.amountCents,
      });
      refunded = await tenantQuery(c, (tx) =>
        refundExpiredBooking(tx, due.paymentIntentId, refund.id, due.amountCents),
      );
    } catch (err) {
      // The event id is already claimed, so a Stripe redelivery will be skipped
      // and will not retry this. That leaves money the guest is owed sitting
      // unrefunded, which is why this is loud rather than swallowed. A
      // reconciliation sweep over expired-and-paid bookings belongs with the
      // watchdog work in Slice 7; app.expired_booking_for_payment_intent
      // already excludes anything already refunded so such a sweep is safe.
      console.error("[stripe-webhook] could not refund an expired booking", err);
    }
  }

  console.log(
    `stripe-webhook: ${event.type} (${event.id}) skipped=${result.skipped} ` +
      `confirmed=${result.confirmed} refunded=${refunded}`,
  );
  return c.json({ received: true, skipped: result.skipped, confirmed: result.confirmed, refunded });
});
