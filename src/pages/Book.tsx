import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CancellationPolicyCard } from "../components/CancellationPolicyCard";
import { DepositSequence } from "../components/EscrowTimeline";
import { DepositNote, PriceBreakdown } from "../components/PriceBreakdown";
import { Shell } from "../components/Shell";
import { GuestStepper } from "../components/booking/GuestStepper";
import { PayStep } from "../components/booking/PayStep";
import { StayCalendar } from "../components/booking/StayCalendar";
import { Button, Progress, Skeleton, StatusMessage } from "../components/ui";
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
import { prettyDay, prettyRange } from "../lib/dates";
import { formatUsd, MIN_STAY_NIGHTS, nightsBetween, quoteStay } from "../lib/money";
import type { CreateBookingResponse } from "../lib/types";

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

  return (
    <Shell focused width="narrow" backTo={listing ? `/listing/${listing.id}` : "/explore"} backLabel="Home details">
      <div className="flex flex-1 flex-col gap-5 pb-8 pt-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-[1.75rem] sm:text-[2rem]">
                {step === 1 ? "Your stay" : step === 2 ? "Price & terms" : "Payment"}
              </h1>
              <p className="m-0 text-sm text-ink-secondary">
                {listing?.title ?? "Loading…"}
                {checkIn && checkOut ? ` · ${prettyRange(checkIn, checkOut)}` : ""}
              </p>
            </div>
            {step > 1 && step < 3 ? (
              <Button variant="quiet" size="sm" onClick={() => setStep((step - 1) as 1 | 2)}>
                Back
              </Button>
            ) : null}
          </div>
          <Progress steps={["Your stay", "Price & terms", "Payment"]} current={step} label="Booking progress" />
        </div>

        {listingQuery.isPending || authLoading ? (
          <div aria-busy="true">
            <p role="status" className="sr-only">
              Loading this home
            </p>
            <Skeleton className="h-64 w-full" />
          </div>
        ) : null}
        {listingQuery.isError ? (
          <StatusMessage tone="danger" title="We couldn't find this home.">
            <p>It may no longer be listed, or the link may be out of date.</p>
          </StatusMessage>
        ) : null}
        {submitError ? <StatusMessage tone="danger" title={submitError} /> : null}
        {restoreNotice ? <RestoreMessage notice={restoreNotice} onDismiss={() => setRestoreNotice(null)} /> : null}

        {listing && step === 1 ? (
          <div className="flex flex-1 flex-col gap-4">
            <StayCalendar checkIn={checkIn} checkOut={checkOut} onPick={pickDay} initialMonth={checkIn} />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-card border border-divider px-4 py-3">
                <p className="m-0 text-metadata font-semibold uppercase tracking-[0.1em] text-ink-secondary">
                  Check-in
                </p>
                <p className="m-0 font-semibold">{checkIn ? prettyDay(checkIn) : "Pick a date"}</p>
                {checkIn ? (
                  <p className="m-0 text-sm text-ink-secondary">
                    From {configQuery.data?.checkinLocalTime ?? "16:00"}
                  </p>
                ) : null}
              </div>
              <div className="rounded-card border border-divider px-4 py-3">
                <p className="m-0 text-metadata font-semibold uppercase tracking-[0.1em] text-ink-secondary">
                  Checkout
                </p>
                <p className="m-0 font-semibold">{checkOut ? prettyDay(checkOut) : "Pick a date"}</p>
                {checkOut ? (
                  <p className="m-0 text-sm text-ink-secondary">
                    By {configQuery.data?.checkoutLocalTime ?? "11:00"}
                  </p>
                ) : null}
              </div>
            </div>

            <GuestStepper
              guests={guests}
              maxGuests={listing.maxGuests}
              onChange={(next) => setGuestsWanted(next)}
            />

            <p className="m-0 text-sm text-ink-secondary">
              Choose at least {MIN_STAY_NIGHTS} nights. Times follow this home's time zone ({listing.timezone}).
            </p>

            <div className="mt-auto flex flex-col gap-2 pt-2">
              <Button block disabled={!quote} onClick={() => { persistSelection(); setStep(2); }}>
                {quote ? "Review price" : "Pick dates to continue"}
              </Button>
              <p className="m-0 text-center text-sm text-ink-secondary">
                Nothing is reserved yet. You'll review the exact price before anything is charged.
              </p>
            </div>
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
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <Button
                block
                busy={creating}
                busyLabel="Checking these dates…"
                onClick={() => void goToPayment()}
              >
                {user ? "Continue to payment" : "Sign in to continue"}
              </Button>
            </div>
            {!user ? (
              <p className="m-0 text-center text-[11.5px] text-ink/50">
                Your dates and guest count stay saved in this browser while you sign in.
              </p>
            ) : null}
          </div>
        ) : null}

        {listing && step === 3 && created ? (
          <PayStep
            listing={listing}
            created={created}
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
          />
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
