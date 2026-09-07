/** Idempotent Stripe event handling. Tests call this with a fake store. */

export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: { id?: string; metadata?: Record<string, string> } };
};

export type WebhookStore = {
  claimEvent: (id: string, type: string) => Promise<boolean>;
  confirmBookingByPaymentIntent: (paymentIntentId: string) => Promise<boolean>;
  /** Null unless the payment settled on a booking the TTL had already expired. */
  findExpiredBooking: (
    paymentIntentId: string,
  ) => Promise<{ bookingId: string; guestTotalCents: number } | null>;
};

export type WebhookResult = {
  skipped: boolean;
  confirmed: boolean;
  /**
   * Set when the guest paid for a booking that had already expired. Issuing the
   * refund is the caller's job, not this function's: it is an outbound HTTP
   * call and must not happen inside the transaction this runs in.
   */
  refundDue: { paymentIntentId: string; amountCents: number } | null;
};

export async function handleStripeEvent(
  event: StripeEventLike,
  store: WebhookStore,
): Promise<WebhookResult> {
  const claimed = await store.claimEvent(event.id, event.type);
  if (!claimed) {
    return { skipped: true, confirmed: false, refundDue: null };
  }

  if (event.type === "payment_intent.succeeded") {
    const piId = event.data.object.id;
    if (!piId) {
      return { skipped: false, confirmed: false, refundDue: null };
    }
    const confirmed = await store.confirmBookingByPaymentIntent(piId);
    if (confirmed) {
      return { skipped: false, confirmed: true, refundDue: null };
    }

    // Nothing to confirm. The case that matters is the guest whose payment
    // settled after the pending TTL had already expired their booking: they
    // paid and hold nothing, so the whole guest_total goes back.
    const expired = await store.findExpiredBooking(piId);
    if (!expired) {
      return { skipped: false, confirmed: false, refundDue: null };
    }
    return {
      skipped: false,
      confirmed: false,
      refundDue: { paymentIntentId: piId, amountCents: expired.guestTotalCents },
    };
  }

  return { skipped: false, confirmed: false, refundDue: null };
}
