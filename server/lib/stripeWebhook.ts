/** Idempotent Stripe event handling. Tests call this with a fake store. */

export type StripeEventLike = {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      metadata?: Record<string, string | undefined> | null;
      payment_intent?: string | { id?: string } | null;
      amount?: number;
      status?: string;
    };
  };
};

export type DisputeOpenedInput = {
  disputeId: string;
  paymentIntentId: string;
  amountCents: number;
  status: string;
};

export type WebhookStore = {
  claimEvent: (id: string, type: string) => Promise<boolean>;
  confirmBookingByPaymentIntent: (paymentIntentId: string) => Promise<boolean>;
  /** Null unless the payment settled on a booking the TTL had already expired. */
  findExpiredBooking: (
    paymentIntentId: string,
  ) => Promise<{ bookingId: string; guestTotalCents: number } | null>;
  recordDisputeOpened: (input: DisputeOpenedInput) => Promise<boolean>;
  recordDisputeClosed: (disputeId: string, status: string) => Promise<boolean>;
  markIdVerified: (userId: string, sessionId: string) => Promise<boolean>;
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
  dispute: "opened" | "closed" | null;
  identityVerified: boolean;
};

function paymentIntentIdOf(object: StripeEventLike["data"]["object"]): string | null {
  const raw = object.payment_intent;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw && typeof raw === "object" && typeof raw.id === "string") return raw.id;
  return null;
}

function metadataUserId(object: StripeEventLike["data"]["object"]): string | null {
  const value = object.metadata?.user_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function handleStripeEvent(
  event: StripeEventLike,
  store: WebhookStore,
): Promise<WebhookResult> {
  const claimed = await store.claimEvent(event.id, event.type);
  if (!claimed) {
    return {
      skipped: true,
      confirmed: false,
      refundDue: null,
      dispute: null,
      identityVerified: false,
    };
  }

  if (event.type === "payment_intent.succeeded") {
    const piId = event.data.object.id;
    if (!piId) {
      return {
        skipped: false,
        confirmed: false,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }
    const confirmed = await store.confirmBookingByPaymentIntent(piId);
    if (confirmed) {
      return {
        skipped: false,
        confirmed: true,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }

    // Nothing to confirm. The case that matters is the guest whose payment
    // settled after the pending TTL had already expired their booking: they
    // paid and hold nothing, so the whole guest_total goes back.
    const expired = await store.findExpiredBooking(piId);
    if (!expired) {
      return {
        skipped: false,
        confirmed: false,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }
    return {
      skipped: false,
      confirmed: false,
      refundDue: { paymentIntentId: piId, amountCents: expired.guestTotalCents },
      dispute: null,
      identityVerified: false,
    };
  }

  if (event.type === "charge.dispute.created") {
    const disputeId = event.data.object.id;
    const paymentIntentId = paymentIntentIdOf(event.data.object);
    if (!disputeId || !paymentIntentId) {
      return {
        skipped: false,
        confirmed: false,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }
    const opened = await store.recordDisputeOpened({
      disputeId,
      paymentIntentId,
      amountCents: Number.isInteger(event.data.object.amount) ? (event.data.object.amount as number) : 0,
      status: event.data.object.status ?? "needs_response",
    });
    return {
      skipped: false,
      confirmed: false,
      refundDue: null,
      dispute: opened ? "opened" : null,
      identityVerified: false,
    };
  }

  if (event.type === "charge.dispute.closed") {
    const disputeId = event.data.object.id;
    if (!disputeId) {
      return {
        skipped: false,
        confirmed: false,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }
    const closed = await store.recordDisputeClosed(disputeId, event.data.object.status ?? "lost");
    return {
      skipped: false,
      confirmed: false,
      refundDue: null,
      dispute: closed ? "closed" : null,
      identityVerified: false,
    };
  }

  if (
    event.type === "identity.verification_session.verified" ||
    (event.type === "identity.verification_session.updated" &&
      event.data.object.status === "verified")
  ) {
    const sessionId = event.data.object.id ?? "";
    const userId = metadataUserId(event.data.object);
    if (!userId) {
      return {
        skipped: false,
        confirmed: false,
        refundDue: null,
        dispute: null,
        identityVerified: false,
      };
    }
    const verified = await store.markIdVerified(userId, sessionId);
    return {
      skipped: false,
      confirmed: false,
      refundDue: null,
      dispute: null,
      identityVerified: verified,
    };
  }

  return {
    skipped: false,
    confirmed: false,
    refundDue: null,
    dispute: null,
    identityVerified: false,
  };
}
