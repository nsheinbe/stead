/**
 * Idempotent Stripe webhook, per BUILD_PROMPT §7. Insert the event id first and
 * skip if it is already there. payment_intent.succeeded confirms the booking;
 * charge.dispute.created/closed freeze and unfreeze; Identity verified raises
 * verification_tier to 2. account.updated writes host payout readiness.
 *
 * Stripe is not a member, so this runs with no app.user_id. The operations it
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
import { recordConnectReadiness } from "../queries/hostProfile";
import { recordPayout } from "../queries/payouts";
import { markIdVerified, recordDisputeClosed, recordDisputeOpened } from "../queries/trust";

export const stripeRoutes = new Hono<AppEnv>();

// Intentionally not rate-limited. Stripe retries on 429 and the handler is
// already idempotent via stripe_events — dropping a delivery is worse than
// processing a duplicate no-op.
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

  const object = event.data.object as {
    id?: string;
    metadata?: Record<string, string> | null;
    payment_intent?: string | { id?: string } | null;
    amount?: number;
    status?: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  };
  const objectId = object.id;

  const result = await tenantQuery(c, (tx) =>
    handleStripeEvent(
      {
        id: event.id,
        type: event.type,
        data: {
          object: {
            id: objectId,
            metadata: object.metadata,
            payment_intent: object.payment_intent,
            amount: object.amount,
            status: object.status,
            charges_enabled: object.charges_enabled,
            payouts_enabled: object.payouts_enabled,
            details_submitted: object.details_submitted,
          },
        },
      },
      {
        claimEvent: (id, type) => claimStripeEvent(tx, id, type),
        confirmBookingByPaymentIntent: (paymentIntentId) =>
          confirmBookingForPaymentIntent(tx, paymentIntentId),
        findExpiredBooking: (paymentIntentId) =>
          findExpiredBookingForPaymentIntent(tx, paymentIntentId),
        recordDisputeOpened: (input) => recordDisputeOpened(tx, input),
        recordDisputeClosed: (disputeId, status) => recordDisputeClosed(tx, disputeId, status),
        markIdVerified: (userId, sessionId) => markIdVerified(tx, userId, sessionId),
        recordConnectReadiness: (input) => recordConnectReadiness(tx, input),
      },
    ),
  );

  // Settlement already happened: a destination charge captures at payment and
  // the funds are in the host's account. Record it, outside the transaction
  // because reading the transfer id is an outbound call.
  let payoutRecorded = false;
  if (result.confirmed && objectId) {
    let transferId: string | null = null;
    try {
      const intent = await getStripe().paymentIntents.retrieve(objectId, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      if (charge && typeof charge !== "string") {
        transferId = typeof charge.transfer === "string" ? charge.transfer : (charge.transfer?.id ?? null);
      }
    } catch (err) {
      // The ledger row still gets written; only the reconciliation handle is
      // missing, and that is better than dropping the record entirely.
      console.error("[stripe-webhook] could not read the transfer id", err);
    }
    payoutRecorded = await tenantQuery(c, (tx) => recordPayout(tx, objectId, transferId));
  }

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
      `confirmed=${result.confirmed} refunded=${refunded} payout=${payoutRecorded} ` +
      `dispute=${result.dispute} identity=${result.identityVerified} ` +
      `connect=${result.connectReadiness}`,
  );
  return c.json({
    received: true,
    skipped: result.skipped,
    confirmed: result.confirmed,
    refunded,
    payoutRecorded,
    dispute: result.dispute,
    identityVerified: result.identityVerified,
    connectReadiness: result.connectReadiness,
  });
});
