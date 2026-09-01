/** Idempotent Stripe event handling. Tests call this with a fake store. */

export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: { id?: string; metadata?: Record<string, string> } };
};

export type WebhookStore = {
  claimEvent: (id: string, type: string) => Promise<boolean>;
  confirmBookingByPaymentIntent: (paymentIntentId: string) => Promise<boolean>;
};

export type WebhookResult = {
  skipped: boolean;
  confirmed: boolean;
};

export async function handleStripeEvent(
  event: StripeEventLike,
  store: WebhookStore,
): Promise<WebhookResult> {
  const claimed = await store.claimEvent(event.id, event.type);
  if (!claimed) {
    return { skipped: true, confirmed: false };
  }

  if (event.type === "payment_intent.succeeded") {
    const piId = event.data.object.id;
    if (!piId) {
      return { skipped: false, confirmed: false };
    }
    const confirmed = await store.confirmBookingByPaymentIntent(piId);
    return { skipped: false, confirmed };
  }

  return { skipped: false, confirmed: false };
}
