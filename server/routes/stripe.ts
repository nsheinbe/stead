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
      },
    ),
  );

  console.log(
    `stripe-webhook: ${event.type} (${event.id}) skipped=${result.skipped} confirmed=${result.confirmed}`,
  );
  return c.json({ received: true, ...result });
});
