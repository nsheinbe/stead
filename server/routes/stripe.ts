/**
 * Idempotent Stripe webhook, per BUILD_PROMPT §7. Insert the event id first and
 * skip if it is already there; payment_intent.succeeded confirms the booking.
 * Disputes and account.updated are acknowledged here and handled in later slices.
 */
import { Hono } from "hono";
import type Stripe from "stripe";
import { handleStripeEvent } from "../lib/stripeWebhook";
import { getStripe } from "../lib/stripe";
import type { AppEnv } from "../lib/http";
import { claimStripeEvent, confirmBookingForPaymentIntent } from "../queries/bookings";

export const stripeRoutes = new Hono<AppEnv>();

stripeRoutes.post("/webhook", async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return c.text("Webhook secret not configured", 500);

  const signature = c.req.header("stripe-signature");
  if (!signature) return c.text("Missing stripe-signature header", 400);

  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch {
    return c.text("Signature verification failed", 400);
  }

  const db = c.get("db");
  const result = await handleStripeEvent(
    {
      id: event.id,
      type: event.type,
      data: {
        object: { id: "id" in event.data.object ? String(event.data.object.id) : undefined },
      },
    },
    {
      claimEvent: (id, type) => claimStripeEvent(db, id, type),
      confirmBookingByPaymentIntent: (paymentIntentId) =>
        confirmBookingForPaymentIntent(db, paymentIntentId),
    },
  );

  console.log(
    `stripe-webhook: ${event.type} (${event.id}) skipped=${result.skipped} confirmed=${result.confirmed}`,
  );
  return c.json({ received: true, ...result });
});
