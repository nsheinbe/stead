import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, format, parseISO, startOfDay } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CancellationPolicyCard } from "../components/CancellationPolicyCard";
import { DepositSequence } from "../components/EscrowTimeline";
import { BackChevron } from "../components/Icons";
import { DepositNote, PriceBreakdown } from "../components/PriceBreakdown";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { StatusMessage } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { loginHref } from "../lib/continuation";
import { depositMethodForNights } from "../lib/deposit";
import {
  deleteBookingDraft,
  latestBookingDraftForListing,
  readBookingDraft,
  saveBookingDraft,
} from "../lib/drafts";
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

/** What happened to a same-device draft, once, for the member to read. */
type RestoreNotice =
  | { kind: "restored"; changed: string[] }
  | { kind: "expired" }
  | { kind: "unavailable" }
  | null;

export function BookPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const [params] = useSearchParams();
  const { user, status: sessionStatus, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guestsWanted, setGuestsWanted] = useState(2);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateBookingResponse | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"));
  const [restoreNotice, setRestoreNotice] = useState<RestoreNotice>(null);
  const restored = useRef(false);

  const listingQuery = useQuery({
    queryKey: ["listing", listingId],
    enabled: Boolean(listingId),
    queryFn: () => api.listing(listingId as string),
  });

  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const listing = listingQuery.data;

  // Server-priced preview for the chosen dates. It reserves nothing, so it is
  // safe before sign-in; creation re-prices independently and its quote is
  // what governs the charge.
  const serverQuote = useQuery({
    queryKey: ["stay-quote", listingId, checkIn, checkOut, guestsWanted],
    enabled: Boolean(listingId && checkIn && checkOut && step >= 2),
    queryFn: () =>
      api.quoteStay({
        listingId: listingId as string,
        checkIn: checkIn as string,
        checkOut: checkOut as string,
        guests: guestsWanted,
      }),
    retry: false,
  });

  const feeBps = serverQuote.data?.networkFeeBps ?? configQuery.data?.networkFeeBps ?? null;

  /**
   * Restore a same-device selection once the listing and config are in hand,
   * so anything that changed while the member was in their inbox can be named
   * before they continue. Restoring lands on the review step: the selection is
   * a preference, never a reservation, and the server re-checks everything at
   * creation.
   */
  useEffect(() => {
    if (restored.current || !listing || !listingId) return;
    if (sessionStatus === "loading") return;
    restored.current = true;

    const result = draftId
      ? readBookingDraft(draftId, user?.id ?? null)
      : (() => {
          const found = latestBookingDraftForListing(listingId, user?.id ?? null);
          return found ? ({ status: "restored", draft: found } as const) : ({ status: "missing" } as const);
        })();

    if (result.status === "unavailable") {
      setRestoreNotice({ kind: "unavailable" });
      return;
    }
    if (result.status === "expired") {
      setRestoreNotice({ kind: "expired" });
      setDraftId(null);
      return;
    }
    if (result.status !== "restored") return;

    const draft = result.draft;
    const nightsInDraft = safeNights(draft.checkIn, draft.checkOut);
    const stale = nightsInDraft < MIN_STAY_NIGHTS || draft.checkIn < isoToday();
    if (stale) {
      setRestoreNotice({ kind: "expired" });
      deleteBookingDraft(draft.draftId);
      setDraftId(null);
      return;
    }

    const changed: string[] = [];
    if (draft.nightlyRateCents !== null && draft.nightlyRateCents !== listing.nightlyRateCents) {
      changed.push(
        `The nightly rate is now ${formatUsd(listing.nightlyRateCents)} (it was ${formatUsd(draft.nightlyRateCents)}).`,
      );
    }
    if (draft.networkFeeBps !== null && feeBps !== null && draft.networkFeeBps !== feeBps) {
      changed.push("The guest network fee has changed since you saved these dates.");
    }
    const guests = Math.min(draft.guests, listing.maxGuests);
    if (guests !== draft.guests) {
      changed.push(`This home welcomes up to ${listing.maxGuests} guests, so the party size was adjusted.`);
    }

    setCheckIn(draft.checkIn);
    setCheckOut(draft.checkOut);
    setGuestsWanted(guests);
    setMonth(startOfDay(parseISO(draft.checkIn)));
    setDraftId(draft.draftId);
    setStep(2);
    setRestoreNotice({ kind: "restored", changed });
  }, [listing, listingId, draftId, user?.id, sessionStatus, feeBps]);

  // The default of 2 is chosen before the listing loads; never send more than it sleeps.
  const guests = listing ? Math.min(guestsWanted, listing.maxGuests) : guestsWanted;
  const nights = checkIn && checkOut ? safeNights(checkIn, checkOut) : 0;
  const localQuote =
    listing && nights >= MIN_STAY_NIGHTS
      ? quoteStay({
          nightlyRateCents: listing.nightlyRateCents,
          nights,
          networkFeeBps: feeBps ?? 200,
          depositCents: listing.depositCents,
        })
      : null;
  // The server's preview wins over the local estimate as soon as it lands.
  const quote = serverQuote.data?.quote ?? localQuote;
  const depositMethod = serverQuote.data?.depositMethod ?? (quote ? depositMethodForNights(quote.nights) : null);
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

  /**
   * Keep this device's copy of the selection. Returns the id so the sign-in
   * destination can point at it; a blocked storage says so rather than
   * pretending the selection is safe.
   */
  function persistSelection(): string | null {
    if (!listing || !checkIn || !checkOut) return null;
    const saved = saveBookingDraft({
      draftId: draftId ?? undefined,
      listingId: listing.id,
      checkIn,
      checkOut,
      guests,
      nightlyRateCents: listing.nightlyRateCents,
      networkFeeBps: feeBps,
      ownerId: user?.id ?? null,
    });
    if (!saved.ok) {
      setRestoreNotice({ kind: "unavailable" });
      return null;
    }
    setDraftId(saved.draft.draftId);
    setRestoreNotice(null);
    return saved.draft.draftId;
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
      // The selection became a real pending booking; the local copy has done
      // its job and must not be restored over the top of it.
      if (draftId) deleteBookingDraft(draftId);
      setDraftId(null);
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
      const id = persistSelection();
      navigate(
        loginHref({
          next: id ? `/book/${listingId}?draft=${id}` : `/book/${listingId}`,
          intent: "renter",
          source: "listing_booking",
        }),
      );
      return;
    }
    const result = created ?? (await createBooking());
    if (result) setStep(3);
  }

  const cells = useMemo(() => monthGrid(month), [month]);
  const today = isoToday();

  return (
    <Shell focused width="narrow" backTo={listing ? `/listing/${listing.id}` : "/explore"} backLabel="Home details">
      <div className="flex flex-1 flex-col pb-7 pt-6">
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
              {step === 1 ? "Your stay" : step === 2 ? "Price & terms" : "Payment"}
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

        {restoreNotice ? (
          <div className="mb-3.5">
            <RestoreMessage notice={restoreNotice} onDismiss={() => setRestoreNotice(null)} />
          </div>
        ) : null}

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
                Earliest checkout for a {MIN_STAY_NIGHTS}-night stay: {prettyDay(minCheckout)}.
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
              onClick={() => {
                persistSelection();
                setStep(2);
              }}
            >
              {quote ? "Review price" : "Pick dates to continue"}
            </button>
            <p className="m-0 text-center text-[11.5px] text-ink/50">
              Choose at least {MIN_STAY_NIGHTS} nights. You'll review the exact price before anything is charged.
            </p>
          </div>
        ) : null}

        {listing && quote && step === 2 ? (
          <div className="flex flex-1 flex-col gap-3.5">
            <div className="flex flex-col gap-3 rounded-[14px] border border-linen-tint px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11.5px] font-bold tracking-[0.12em] text-ink/50">YOUR STAY</span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-sm font-semibold text-spruce underline"
                >
                  Edit dates
                </button>
              </div>
              <p className="m-0 text-sm text-ink/70">
                {checkIn && checkOut ? prettyRange(checkIn, checkOut) : ""} · {quote.nights} nights · {guests}{" "}
                {guests === 1 ? "guest" : "guests"}
              </p>
              <PriceBreakdown
                nightlyRateCents={quote.nightly_rate_cents}
                nights={quote.nights}
                staySubtotalCents={quote.stay_subtotal_cents}
                networkFeeCents={quote.network_fee_cents}
                guestTotalCents={quote.guest_total_cents}
                networkFeeBps={feeBps}
              />
              <p className="m-0 text-xs text-ink/55">
                {serverQuote.data
                  ? "Priced for these exact dates. Payment processing and any applicable taxes are not represented in this quote."
                  : "An estimate. We'll show the exact amount before you pay."}
              </p>
            </div>
            {depositMethod ? (
              <>
                <DepositNote
                  amountCents={quote.deposit_cents}
                  method={depositMethod}
                  claimWindowHours={configQuery.data?.claimWindowHours ?? null}
                />
                <div className="rounded-[14px] border border-linen-tint px-4 py-4">
                  <h3 className="m-0 text-sm font-bold">How the deposit works</h3>
                  <div className="mt-2">
                    <DepositSequence method={depositMethod} />
                  </div>
                </div>
              </>
            ) : null}
            {serverQuote.isError ? (
              <StatusMessage tone="warning" title="We couldn't price these dates just now.">
                <p>The amounts below are an estimate. You'll see the exact amount before you pay.</p>
              </StatusMessage>
            ) : null}
            <CancellationPolicyCard policy={listing.cancellationPolicy} compact />
            <button
              type="button"
              disabled={creating}
              className="mt-auto rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep disabled:opacity-60"
              onClick={() => void goToPayment()}
            >
              {creating ? "Checking these dates…" : user ? "Continue to payment" : "Sign in to continue"}
            </button>
            {!user ? (
              <p className="m-0 text-center text-[11.5px] text-ink/50">
                Your dates and guest count stay saved in this browser while you sign in.
              </p>
            ) : null}
          </div>
        ) : null}

        {listing && quote && step === 3 && created ? (
          <PayStep listing={listing} quote={quote} created={created} checkIn={checkIn} checkOut={checkOut} guests={guests} />
        ) : null}
      </div>
    </Shell>
  );
}

function RestoreMessage({ notice, onDismiss }: { notice: NonNullable<RestoreNotice>; onDismiss: () => void }) {
  if (notice.kind === "unavailable") {
    return (
      <StatusMessage tone="warning" title="Your selections couldn't be saved on this device.">
        <p>You can still choose dates and continue. Signing in may mean choosing them again.</p>
      </StatusMessage>
    );
  }
  if (notice.kind === "expired") {
    return (
      <StatusMessage tone="warning" title="Those saved dates are no longer usable.">
        <p>Choose your dates again. Nothing was reserved.</p>
      </StatusMessage>
    );
  }
  return (
    <StatusMessage
      tone={notice.changed.length > 0 ? "warning" : "success"}
      title={
        notice.changed.length > 0
          ? "We restored your dates. Some details changed."
          : "We restored the dates you chose."
      }
      action={
        <button type="button" onClick={onDismiss} className="text-sm font-semibold underline">
          Dismiss
        </button>
      }
    >
      {notice.changed.length > 0 ? (
        <ul className="m-0 list-disc pl-5">
          {notice.changed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>Review the price below. Nothing is reserved until you pay.</p>
      )}
    </StatusMessage>
  );
}

function isoToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function safeNights(checkIn: string, checkOut: string): number {
  try {
    return nightsBetween(checkIn, checkOut);
  } catch {
    return 0;
  }
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
  // What the processor will actually take. The deposit is NOT part of it:
  // the server's PaymentIntent is for guest_total_cents, and the deposit is a
  // separate arrangement on the host's connected account.
  const payable = created.quote.guest_total_cents;

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
          <StripePayForm bookingId={created.bookingId} payableLabel={formatUsd(payable)} />
        </Elements>
      ) : (
        <StatusMessage tone="warning" title="Payment is unavailable right now. Your stay is not confirmed.">
          <p>Your dates are held briefly while payment is unavailable. Please try again shortly.</p>
        </StatusMessage>
      )}

      <div className="flex flex-col gap-2.5 rounded-[14px] border border-linen-tint px-4 py-4">
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

function StripePayForm({ bookingId, payableLabel }: { bookingId: string; payableLabel: string }) {
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
        className="rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep disabled:opacity-60"
      >
        {busy ? "Confirming your payment…" : `Pay ${payableLabel}`}
      </button>
    </div>
  );
}
