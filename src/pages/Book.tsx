import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, format, parseISO, startOfDay } from "date-fns";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EscrowTimeline } from "../components/EscrowTimeline";
import { BackChevron, ScaleIcon } from "../components/Icons";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { monthGrid, prettyDay, prettyRange } from "../lib/dates";
import { stripePublishableKey } from "../lib/env";
import { formatUsd, MIN_STAY_NIGHTS, nightsBetween, quoteStay, type StayQuote } from "../lib/money";
import type { CreateBookingResponse, ListingDetail } from "../lib/types";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  const key = stripePublishableKey();
  if (!key) return Promise.resolve(null);
  stripePromise ??= loadStripe(key);
  return stripePromise;
}

export function BookPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guestsWanted, setGuestsWanted] = useState(2);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateBookingResponse | null>(null);

  const listingQuery = useQuery({
    queryKey: ["listing", listingId],
    enabled: Boolean(listingId),
    queryFn: () => api.listing(listingId as string),
  });

  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const listing = listingQuery.data;
  // The default of 2 is chosen before the listing loads; never send more than it sleeps.
  const guests = listing ? Math.min(guestsWanted, listing.maxGuests) : guestsWanted;
  let nights = 0;
  if (checkIn && checkOut) {
    try {
      nights = nightsBetween(checkIn, checkOut);
    } catch {
      nights = 0;
    }
  }
  const quote =
    listing && nights >= MIN_STAY_NIGHTS
      ? quoteStay({
          nightlyRateCents: listing.nightlyRateCents,
          nights,
          networkFeeBps: configQuery.data?.networkFeeBps ?? 200,
          depositCents: listing.depositCents,
        })
      : null;
  const minCheckout = checkIn ? format(addDays(parseISO(checkIn), MIN_STAY_NIGHTS), "yyyy-MM-dd") : null;

  function pickDay(iso: string) {
    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(iso);
      setCheckOut(null);
      return;
    }
    if (iso <= checkIn) {
      setCheckIn(iso);
      setCheckOut(null);
      return;
    }
    // Do not accept a checkout that would only fail on submit.
    if (minCheckout && iso < minCheckout) return;
    setCheckOut(iso);
  }

  async function createBooking(): Promise<CreateBookingResponse | null> {
    if (!listing || !checkIn || !checkOut || !quote || !user) return null;
    setCreating(true);
    setSubmitError(null);
    try {
      const payload = await api.createBooking({
        listingId: listing.id,
        checkIn,
        checkOut,
        guests,
      });
      setCreated(payload);
      return payload;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not start checkout");
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function goToPayment() {
    if (!user) {
      navigate(`/login?next=/book/${listingId}`);
      return;
    }
    const result = created ?? (await createBooking());
    if (result) setStep(3);
  }

  const cells = useMemo(() => monthGrid(month), [month]);
  const today = isoToday();

  return (
    <Shell hideNav>
      <div className="flex flex-1 flex-col px-[18px] pb-7 pt-16 md:pt-6">
        <div className="mb-3.5 flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linen"
            onClick={() => {
              if (step === 1) navigate(listing ? `/listing/${listing.id}` : "/explore");
              else setStep((step - 1) as 1 | 2);
            }}
          >
            <BackChevron />
          </button>
          <div className="flex flex-1 flex-col">
            <span className="text-base font-bold">
              {step === 1 ? "Request to book" : step === 2 ? "Price & deposit" : "Confirm & pay"}
            </span>
            <span className="text-xs text-ink/55">
              {listing?.title ?? "Stay"}
              {checkIn && checkOut ? ` · ${prettyRange(checkIn, checkOut)}` : ""}
            </span>
          </div>
          <span className="money text-[12.5px] font-bold text-ink/50">{step} of 3</span>
        </div>
        <div className="mb-4 flex gap-1.5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full ${n <= step ? "bg-spruce" : "bg-[#E5DDCA]"}`}
            />
          ))}
        </div>

        {listingQuery.isLoading || authLoading ? <StatusBanner title="Loading…" /> : null}
        {listingQuery.isError ? <StatusBanner title="Listing not found" /> : null}
        {submitError ? <StatusBanner tone="claim" title={submitError} /> : null}

        {listing && step === 1 ? (
          <div className="flex flex-1 flex-col gap-3.5">
            <div className="flex flex-col gap-2.5 rounded-card bg-linen p-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-[15px] font-bold">{format(month, "MMMM yyyy")}</span>
                <div className="flex gap-4">
                  <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
                    ‹
                  </button>
                  <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
                    ›
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 justify-items-center text-[11.5px] font-semibold text-ink/45">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <span key={`${d}-${i}`}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 justify-items-center gap-y-0.5">
                {cells.map(({ date, inMonth }) => {
                  const iso = format(date, "yyyy-MM-dd");
                  const tooShort = Boolean(checkIn && !checkOut && minCheckout && iso > checkIn && iso < minCheckout);
                  const disabled = !inMonth || iso < today || tooShort;
                  const selected = iso === checkIn || iso === checkOut;
                  const inRange = checkIn && checkOut && iso > checkIn && iso < checkOut;
                  return (
                    <button
                      key={iso + String(inMonth)}
                      type="button"
                      disabled={disabled}
                      onClick={() => pickDay(iso)}
                      className={`h-9 w-9 rounded-full text-[13px] ${
                        selected
                          ? "bg-spruce font-bold text-paper"
                          : inRange
                            ? "bg-spruce/15 font-semibold"
                            : disabled
                              ? "text-ink/25"
                              : "font-medium"
                      }`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-0.5 rounded-xl border border-linen-tint px-3.5 py-2.5">
                <span className="text-[11px] font-bold tracking-wider text-ink/50">CHECK-IN</span>
                <span className="text-[14.5px] font-bold">
                  {checkIn ? `${prettyDay(checkIn)} · ${configQuery.data?.checkinLocalTime ?? "16:00"}` : "Pick a date"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-xl border border-linen-tint px-3.5 py-2.5">
                <span className="text-[11px] font-bold tracking-wider text-ink/50">CHECKOUT</span>
                <span className="text-[14.5px] font-bold">
                  {checkOut ? `${prettyDay(checkOut)} · ${configQuery.data?.checkoutLocalTime ?? "11:00"}` : "Pick a date"}
                </span>
              </div>
            </div>
            {checkIn && !checkOut && minCheckout ? (
              <p className="m-0 text-center text-[12px] text-ink/55">
                Checkout from {prettyDay(minCheckout)} — {MIN_STAY_NIGHTS} nights from check-in.
              </p>
            ) : null}
            <div className="flex items-center justify-between rounded-xl border border-linen-tint px-3.5 py-3">
              <div className="flex flex-col">
                <span className="text-[14.5px] font-bold">Guests</span>
                <span className="text-xs text-ink/55">This home sleeps {listing.maxGuests}</span>
              </div>
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  aria-label="Fewer guests"
                  className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[#D8CDB6] text-xl text-ink/60"
                  onClick={() => setGuestsWanted(Math.max(1, guests - 1))}
                >
                  −
                </button>
                <span className="money text-[17px] font-bold">{guests}</span>
                <button
                  type="button"
                  aria-label="More guests"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-spruce text-xl text-paper"
                  onClick={() => setGuestsWanted(Math.min(listing.maxGuests, guests + 1))}
                >
                  +
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={!quote}
              className="mt-auto rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper disabled:opacity-40 hover:bg-spruce-deep"
              onClick={() => setStep(2)}
            >
              {quote
                ? `Continue — ${formatUsd(quote.stay_subtotal_cents)} for ${quote.nights} nights`
                : "Pick dates to continue"}
            </button>
            <p className="m-0 text-center text-[11.5px] text-ink/50">
              Monthly stays only — {MIN_STAY_NIGHTS} nights minimum. The 2% shows up next, in full view.
            </p>
          </div>
        ) : null}

        {listing && quote && step === 2 ? (
          <div className="flex flex-1 flex-col gap-3.5">
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-linen-tint px-4 py-4">
              <span className="text-[11.5px] font-bold tracking-[0.12em] text-ink/50">THE STAY</span>
              <PriceBreakdown
                nightlyRateCents={quote.nightly_rate_cents}
                nights={quote.nights}
                staySubtotalCents={quote.stay_subtotal_cents}
                networkFeeCents={quote.network_fee_cents}
                guestTotalCents={quote.guest_total_cents}
                hostLine
              />
            </div>
            <div className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-dashed border-brass/75 bg-brass/[0.06] px-4 py-4">
              <div className="flex items-baseline justify-between">
                <span className="money text-[14.5px] font-bold">
                  {formatUsd(quote.deposit_cents)} incidentals deposit
                </span>
                <span className="text-[11px] font-bold text-brass-deep">RETURNS TO YOU</span>
              </div>
              <p className="m-0 text-[12.5px] leading-relaxed text-ink/65">
                Held in neutral escrow — an account neither the host nor Stead controls. Auto-returned after checkout
                plus the claim window, unless a claim is filed.
              </p>
              <EscrowTimeline activeIndex={0} />
            </div>
            <div className="flex items-start gap-2.5 px-1">
              <ScaleIcon />
              <span className="text-xs leading-relaxed text-ink/55">
                Claims require photo evidence. Disputes go to independent arbitration — both sides see the identical
                file.
              </span>
            </div>
            <button
              type="button"
              disabled={creating}
              className="mt-auto rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep"
              onClick={() => void goToPayment()}
            >
              {creating ? "Holding your dates…" : "Continue to payment"}
            </button>
          </div>
        ) : null}

        {listing && quote && step === 3 && created ? (
          <PayStep listing={listing} quote={quote} created={created} checkIn={checkIn} checkOut={checkOut} guests={guests} />
        ) : null}
      </div>
    </Shell>
  );
}

function isoToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function PayStep({
  listing,
  quote,
  created,
  checkIn,
  checkOut,
  guests,
}: {
  listing: ListingDetail;
  quote: StayQuote;
  created: CreateBookingResponse;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
}) {
  const thumb = listing.photos[0]?.storagePath;
  const cardTotal = quote.guest_total_cents + quote.deposit_cents;

  return (
    <div className="flex flex-1 flex-col gap-3.5">
      <div className="flex items-center gap-3 rounded-[14px] bg-linen px-3.5 py-3">
        <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[10px] bg-linen-tint">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[14.5px] font-bold">{listing.title}</span>
          <span className="text-xs text-ink/55">
            {checkIn && checkOut ? prettyRange(checkIn, checkOut) : ""} · {quote.nights} nights · {guests} guests
          </span>
        </div>
      </div>

      {created.paymentClientSecret && stripePublishableKey() ? (
        <Elements stripe={getStripe()} options={{ clientSecret: created.paymentClientSecret }}>
          <StripePayForm bookingId={created.bookingId} totalLabel={formatUsd(cardTotal)} />
        </Elements>
      ) : (
        <StatusBanner
          title="Stripe test keys are not configured"
          detail="The booking is pending_payment and holds the dates for 30 minutes. Set STRIPE_SECRET_KEY and VITE_STRIPE_PUBLISHABLE_KEY for the Payment Element path. Tests mock Stripe."
        />
      )}

      <div className="flex flex-col gap-2.5 rounded-[14px] border border-linen-tint px-4 py-4">
        <div className="money flex justify-between text-sm">
          <span className="text-ink/70">Due now — the stay</span>
          <span className="font-semibold">{formatUsd(quote.guest_total_cents)}</span>
        </div>
        <div className="money flex justify-between text-sm">
          <span className="text-ink/70">Into escrow — deposit</span>
          <span className="font-semibold">{formatUsd(quote.deposit_cents)}</span>
        </div>
        <div className="h-px bg-[#EDE5D3]" />
        <div className="money flex items-baseline justify-between">
          <span className="text-sm font-bold">Card total today</span>
          <span className="text-base font-bold">{formatUsd(cardTotal)}</span>
        </div>
        <span className="money text-[11.5px] text-ink/55">
          {formatUsd(quote.deposit_cents)} of it comes straight back after the claim window, unless a claim is filed.
        </span>
      </div>
      <p className="m-0 text-center text-[11.5px] text-ink/50">
        The host is paid {formatUsd(quote.stay_subtotal_cents)} at your check-in — instantly.
      </p>
      {created.mockPayment ? (
        <Link
          to="/trips"
          className="rounded-xl bg-spruce py-4 text-center text-[15.5px] font-bold text-paper no-underline hover:bg-spruce-deep hover:text-paper"
        >
          View trips
        </Link>
      ) : null}
    </div>
  );
}

function StripePayForm({ bookingId, totalLabel }: { bookingId: string; totalLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/trips/${bookingId}`,
      },
      redirect: "if_required",
    });
    setBusy(false);
    if (confirmError) {
      setError(confirmError.message ?? "Payment failed");
      return;
    }
    navigate(`/trips/${bookingId}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="px-0.5 text-[11.5px] font-bold tracking-[0.12em] text-ink/50">PAY WITH</span>
      <div className="rounded-xl border-[1.5px] border-spruce bg-spruce/[0.04] p-3.5">
        <PaymentElement />
      </div>
      {error ? <StatusBanner tone="claim" title={error} /> : null}
      <button
        type="button"
        disabled={!stripe || busy}
        onClick={() => void pay()}
        className="rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep"
      >
        {busy ? "Confirming…" : `Confirm & pay ${totalLabel}`}
      </button>
    </div>
  );
}
