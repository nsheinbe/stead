import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { prettyRange } from "../../lib/dates";
import { stripePublishableKey } from "../../lib/env";
import { formatUsd } from "../../lib/money";
import { DepositNote, PriceBreakdown } from "../PriceBreakdown";
import { Button, ButtonLink, Card, StatusMessage } from "../ui";
import type { CreateBookingResponse, ListingDetail } from "../../lib/types";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  const key = stripePublishableKey();
  if (!key) return Promise.resolve(null);
  stripePromise ??= loadStripe(key);
  return stripePromise;
}

/**
 * The payment step.
 *
 * Two rules govern everything here. The amount on the button is the amount the
 * processor will take — the server's `guest_total_cents`, never with the
 * deposit added. And confirmation comes from the booking's own status, never
 * from a redirect landing or a resolved promise: after the processor accepts,
 * the stay shows as processing until the server says confirmed.
 *
 * PAY-02 is where the connected-account deposit setup gets completed and
 * verified. Until then this step does not claim the deposit method is set up.
 */
export function PayStep({
  listing,
  created,
  checkIn,
  checkOut,
  guests,
}: {
  listing: ListingDetail;
  created: CreateBookingResponse;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
}) {
  const payable = created.quote.guest_total_cents;
  const configured = Boolean(created.paymentClientSecret && stripePublishableKey());

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Card padding="sm">
        <p className="m-0 font-semibold">{listing.title}</p>
        <p className="m-0 text-sm text-ink-secondary">
          {checkIn && checkOut ? `${prettyRange(checkIn, checkOut)} · ` : ""}
          {created.quote.nights} nights · {guests} {guests === 1 ? "guest" : "guests"}
        </p>
      </Card>

      <div className="rounded-card border border-divider p-4">
        <PriceBreakdown
          nightlyRateCents={created.quote.nightly_rate_cents}
          nights={created.quote.nights}
          staySubtotalCents={created.quote.stay_subtotal_cents}
          networkFeeCents={created.quote.network_fee_cents}
          guestTotalCents={created.quote.guest_total_cents}
          networkFeeBps={created.networkFeeBps}
          authoritative
        />
      </div>

      <DepositNote amountCents={created.quote.deposit_cents} method={created.depositMethod} />

      {configured ? (
        <Elements stripe={getStripe()} options={{ clientSecret: created.paymentClientSecret as string }}>
          <StripePayForm bookingId={created.bookingId} payableLabel={formatUsd(payable)} />
        </Elements>
      ) : created.mockPayment ? (
        <StatusMessage tone="warning" title="Payment is not configured in this environment." live={false}>
          <p>
            Your stay is not confirmed. This is a development build with no payment processor, so no charge can be
            made here.
          </p>
        </StatusMessage>
      ) : (
        <StatusMessage tone="danger" title="Payment is unavailable right now. Your stay is not confirmed.">
          <p>Nothing has been charged. Please try again shortly.</p>
        </StatusMessage>
      )}

      <ButtonLink to={`/trips/${created.bookingId}`} variant="secondary">
        View this stay
      </ButtonLink>
    </div>
  );
}

/**
 * Card entry and confirmation.
 *
 * `redirect: "if_required"` keeps most cards in-page; a card that needs a
 * redirect comes back to the stay page, which reads the server's status. Both
 * paths end in the same place, and neither declares success itself.
 */
function StripePayForm({ bookingId, payableLabel }: { bookingId: string; payableLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"ready" | "submitting" | "processing">("ready");
  const [error, setError] = useState<string | null>(null);

  // Once the processor has accepted, the booking's own status is the only
  // thing that may say "confirmed".
  const trip = useQuery({
    queryKey: ["trip", bookingId],
    enabled: phase === "processing",
    queryFn: () => api.trip(bookingId),
    refetchInterval: (query) => (query.state.data?.status === "pending_payment" ? 2_000 : false),
  });

  const confirmed = trip.data && trip.data.status !== "pending_payment";
  if (confirmed) {
    navigate(`/trips/${bookingId}`, { replace: true });
  }

  async function pay() {
    if (!stripe || !elements) return;
    setPhase("submitting");
    setError(null);
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/trips/${bookingId}` },
      redirect: "if_required",
    });
    if (confirmError) {
      setPhase("ready");
      // Stripe's decline messages are member-facing; anything else is not.
      setError(
        confirmError.type === "card_error" || confirmError.type === "validation_error"
          ? (confirmError.message ?? "Payment wasn't completed. Review the payment details and try again.")
          : "Payment wasn't completed. Review the payment details and try again.",
      );
      return;
    }
    setPhase("processing");
  }

  if (phase === "processing") {
    return (
      <StatusMessage tone="info" title="We're checking your payment.">
        <p>Your stay will show as confirmed when payment is verified. You can leave this page.</p>
      </StatusMessage>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-divider p-4">
        <PaymentElement />
      </div>
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      <Button
        block
        disabled={!stripe}
        busy={phase === "submitting"}
        busyLabel="Confirming your payment…"
        onClick={() => void pay()}
      >
        Pay {payableLabel}
      </Button>
      <p className="m-0 text-sm text-ink-secondary">
        The deposit arrangement above is separate and is not part of this charge.
      </p>
    </div>
  );
}
