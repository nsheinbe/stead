import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CancellationPolicyCard } from "../components/CancellationPolicyCard";
import { EscrowTimeline } from "../components/EscrowTimeline";
import { ListingPhoto } from "../components/ListingPhoto";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  DataRow,
  Dialog,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
  Textarea,
  TextInput,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { dollarsToCents } from "../lib/cents";
import { prettyDay, prettyRange } from "../lib/dates";
import { depositHeading } from "../lib/fees";
import { formatUsd } from "../lib/money";
import { tripState } from "../lib/tripStatus";
import { CLAIM_STATE_LABEL, type TripDetail } from "../lib/types";

/**
 * One stay, from the server's point of view.
 *
 * Every fact on this page is one the server recorded: the status decides what
 * the stay is, the cancellation preview decides what a cancellation would
 * refund, and the deposit timeline comes from `escrow_audit`. Nothing is
 * projected forward and nothing counts down.
 *
 * The two recovery cases are the ones that used to render as a bare status
 * word. A stay with no recorded payment says so — not that payment failed,
 * because a settling payment and an abandoned checkout look the same from
 * here. An expired hold says the dates were released and nothing was charged.
 * Neither offers a "finish paying" action: resuming an existing booking's
 * payment has no contract yet, and sending someone back to checkout would hold
 * the same dates twice.
 */
export function TripDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user, status: sessionStatus } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const trip = useQuery({
    queryKey: ["trip", bookingId],
    enabled: Boolean(user) && Boolean(bookingId),
    queryFn: () => api.trip(bookingId as string),
    retry: false,
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
    await queryClient.invalidateQueries({ queryKey: ["trips"] });
  };

  const file = useMutation({
    mutationFn: () => {
      const amountCents = dollarsToCents(amount);
      if (amountCents == null || amountCents < 1 || !bookingId) {
        throw new ApiError(400, "Enter a dollar amount at or under the deposit");
      }
      return api.fileClaim({ bookingId, amountCents, description });
    },
    onSuccess: invalidate,
  });

  const cancelStay = useMutation({
    mutationFn: () => {
      if (!bookingId) throw new ApiError(400, "Missing stay");
      return api.cancelTrip(bookingId);
    },
    onSuccess: async () => {
      setConfirmCancel(false);
      await invalidate();
    },
  });

  const respond = useMutation({
    mutationFn: (accept: boolean) => {
      const id = trip.data?.claim?.id;
      if (!id) throw new ApiError(400, "No claim on this stay");
      return api.respondClaim(id, accept);
    },
    onSuccess: invalidate,
  });

  const booking = trip.data;
  const notFound = trip.error instanceof ApiError && trip.error.status === 404;

  if (sessionStatus !== "signed_in") {
    return (
      <Shell width="narrow" workspace="renter" title="Your stay">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to see this stay"
            description="Only the guest on this stay and the home's host can open it."
            intent="renter"
          />
        </div>
      </Shell>
    );
  }

  if (trip.isPending) {
    return (
      <Shell width="narrow" workspace="renter" title="Your stay">
        <div className="flex flex-1 flex-col gap-4 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this stay
          </p>
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </Shell>
    );
  }

  if (notFound || !booking) {
    return (
      <Shell width="narrow" workspace="renter" title="Your stay">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="We couldn't find this stay."
            description="It may no longer exist, or this link may belong to someone else's booking."
          />
          <ButtonLink to="/trips" className="self-start">
            Your stays
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  if (trip.isError) {
    return (
      <Shell width="narrow" workspace="renter" title="Your stay">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <StatusMessage
            tone="danger"
            title="We couldn't load this stay."
            action={
              <Button variant="secondary" size="sm" onClick={() => void trip.refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      </Shell>
    );
  }

  const listing = booking.listing;
  const escrow = booking.escrow;
  const state = tripState({
    status: booking.status,
    listingId: listing.id,
    bookingId: booking.id,
    viewerIsHost: booking.viewerIsHost,
    review: booking.review,
  });
  const other = booking.viewerIsHost ? booking.guest : booking.host;
  const place = [listing.city, listing.region].filter(Boolean).join(", ");

  return (
    <Shell width="narrow" workspace="renter" title="Your stay" backTo="/trips" backLabel="Your stays">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <PageHeader title={listing.title} description={`${prettyRange(booking.checkIn, booking.checkOut)} · ${place}`} />
            <StatusPill tone={state.tone === "brand" ? "brand" : "neutral"}>{state.label}</StatusPill>
          </div>
          <p className="m-0 max-w-reading text-ink-secondary">{state.meaning}</p>
          {state.action ? (
            <ButtonLink to={state.action.to} variant="secondary" className="self-start">
              {state.action.label}
            </ButtonLink>
          ) : null}
        </div>

        <div className="flex gap-4">
          <div className="w-28 shrink-0 sm:w-36">
            <ListingPhoto src={listing.photos[0]?.storagePath} alt="" className="rounded-card" />
          </div>
          <Card padding="sm" className="flex-1">
            <DataList>
              <DataRow label="Check-in" value={checkInLine(booking, config.data?.checkinLocalTime)} />
              <DataRow label="Checkout" value={checkOutLine(booking, config.data?.checkoutLocalTime)} />
              <DataRow label="Guests" value={String(booking.guests)} />
              <DataRow label="Time zone" value={listing.timezone} />
            </DataList>
          </Card>
        </div>

        {/* --- arrival ---------------------------------------------- */}
        {booking.status === "confirmed" || booking.status === "checked_in" ? (
          <Surface padding="sm">
            <h2 className="m-0 text-base font-semibold">Getting in</h2>
            <p className="mb-0 mt-2 text-sm text-ink-secondary">
              {booking.viewerIsHost
                ? `Send ${other.displayName} the arrival details before check-in. Stead doesn't hold keys or codes.`
                : `Your host shares arrival details directly. Message ${other.displayName} if you haven't had them yet.`}
            </p>
            <div className="mt-4">
              <ButtonLink
                to={`/messages/${listing.id}/${booking.guest.id}`}
                variant="secondary"
                size="sm"
              >
                Message {other.displayName}
              </ButtonLink>
            </div>
          </Surface>
        ) : (
          <div>
            <ButtonLink to={`/messages/${listing.id}/${booking.guest.id}`} variant="secondary">
              Message {other.displayName}
            </ButtonLink>
          </div>
        )}

        {/* --- money ------------------------------------------------ */}
        <section aria-labelledby="price-heading" className="flex flex-col gap-3">
          <h2 id="price-heading" className="m-0 text-card-title">
            What this stay cost
          </h2>
          <Card padding="sm">
            <PriceBreakdown
              nightlyRateCents={booking.nightlyRateCents}
              nights={booking.nights}
              staySubtotalCents={booking.staySubtotalCents}
              networkFeeCents={booking.networkFeeCents}
              guestTotalCents={booking.guestTotalCents}
              networkFeeBps={booking.networkFeeBps}
              authoritative
            />
            <p className="m-0 mt-3 text-sm text-ink-secondary">
              These are the figures recorded when the stay was booked, not today's rates. The{" "}
              {depositHeading().toLowerCase()} below is separate from this charge.
            </p>
          </Card>
        </section>

        {/* --- deposit ---------------------------------------------- */}
        <section aria-labelledby="deposit-heading" className="flex flex-col gap-3">
          <h2 id="deposit-heading" className="m-0 text-card-title">
            {depositHeading()}
          </h2>
          <Card padding="sm" data-testid="deposit-status">
            <div className="flex items-baseline justify-between gap-4">
              <p className="m-0 text-sm text-ink-secondary">Amount</p>
              <p className="money m-0 font-semibold">
                {formatUsd(escrow?.amountCents ?? booking.depositCents)}
              </p>
            </div>
            <div className="mt-4">
              {escrow ? (
                <EscrowTimeline escrow={escrow} timezone={listing.timezone} />
              ) : (
                <p className="m-0 text-sm text-ink-secondary">
                  Nothing has been recorded against the deposit for this stay.
                </p>
              )}
            </div>
          </Card>
        </section>

        {/* --- claim ------------------------------------------------ */}
        {booking.claim ? (
          <section aria-labelledby="claim-heading" className="flex flex-col gap-3">
            <h2 id="claim-heading" className="m-0 text-card-title">
              Claim on this stay
            </h2>
            <Card padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="money m-0 font-semibold">{formatUsd(booking.claim.amountCents)}</p>
                <StatusPill tone={booking.claim.state === "open" ? "danger" : "neutral"}>
                  {CLAIM_STATE_LABEL[booking.claim.state]}
                </StatusPill>
              </div>
              <p className="mb-0 mt-3 whitespace-pre-line text-ink-secondary">{booking.claim.description}</p>

              {!booking.viewerIsHost && booking.claim.state === "open" ? (
                <div className="mt-4 flex flex-col gap-3">
                  <p className="m-0 text-sm text-ink-secondary">
                    Accepting lets the agreed amount be charged to your card on file. Disputing sends the
                    claim to independent arbitration.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      size="sm"
                      busy={respond.isPending && respond.variables === true}
                      onClick={() => respond.mutate(true)}
                    >
                      Accept this claim
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      busy={respond.isPending && respond.variables === false}
                      onClick={() => respond.mutate(false)}
                    >
                      Dispute it
                    </Button>
                  </div>
                </div>
              ) : null}

              {respond.isError ? (
                <div className="mt-4">
                  <StatusMessage
                    tone="danger"
                    title={
                      respond.error instanceof ApiError
                        ? respond.error.message
                        : "We couldn't record that. Please try again."
                    }
                  />
                </div>
              ) : null}

              <p className="mb-0 mt-4">
                <Link to={`/host/claims/${booking.claim.id}`} className="text-sm font-semibold">
                  See the full claim
                </Link>
              </p>
            </Card>
          </section>
        ) : booking.viewerIsHost && escrow?.state === "claim_window" ? (
          <section aria-labelledby="file-claim-heading" className="flex flex-col gap-3">
            <h2 id="file-claim-heading" className="m-0 text-card-title">
              File a claim
            </h2>
            <Card padding="sm">
              <p className="m-0 text-sm text-ink-secondary">
                The claim window on this stay is open. A claim cannot exceed the{" "}
                {formatUsd(escrow.amountCents)} deposit, and your guest can accept it or dispute it.
              </p>
              <form
                className="mt-4 flex flex-col gap-5"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  const cents = dollarsToCents(amount);
                  if (cents == null || cents < 1) {
                    setAmountError("Enter an amount in dollars, such as 150 or 150.50.");
                    return;
                  }
                  if (cents > escrow.amountCents) {
                    setAmountError(`A claim cannot exceed the ${formatUsd(escrow.amountCents)} deposit.`);
                    return;
                  }
                  setAmountError(null);
                  file.mutate();
                }}
              >
                <TextInput
                  id="claim-amount"
                  label="Amount"
                  hint="In US dollars."
                  inputMode="decimal"
                  className="money"
                  value={amount}
                  error={amountError}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountError(null);
                  }}
                />
                <Textarea
                  id="claim-description"
                  label="What happened"
                  hint="Your guest sees this, and so does an arbiter if it's disputed."
                  rows={4}
                  required
                  minLength={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                {file.isError ? (
                  <StatusMessage
                    tone="danger"
                    title={
                      file.error instanceof ApiError
                        ? file.error.message
                        : "We couldn't file that claim. Please try again."
                    }
                  />
                ) : null}
                <Button type="submit" variant="danger" className="self-start" busy={file.isPending} busyLabel="Filing…">
                  File this claim
                </Button>
              </form>
            </Card>
          </section>
        ) : null}

        {/* --- terms and cancellation ------------------------------- */}
        <section aria-labelledby="terms-heading" className="flex flex-col gap-3">
          <h2 id="terms-heading" className="m-0 text-card-title">
            Cancellation
          </h2>
          <CancellationPolicyCard policy={booking.cancellationPolicy} />

          {booking.cancellation.canCancel ? (
            <Card padding="sm">
              <p className="m-0 text-sm text-ink-secondary" data-testid="cancel-preview-summary">
                {booking.cancellation.summary}
              </p>
              <div className="mt-4">
                <DataList>
                  <DataRow
                    label="Refund to the card"
                    value={
                      <span data-testid="cancel-preview-refund">
                        {formatUsd(booking.cancellation.refundCents)}
                      </span>
                    }
                  />
                  <DataRow
                    label="Deposit released"
                    value={formatUsd(booking.cancellation.depositReleasedCents)}
                  />
                </DataList>
              </div>
              <p className="m-0 mt-3 text-sm text-ink-secondary">
                These figures come from the server and are what would actually be refunded today.
              </p>
              <div className="mt-4">
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                  {booking.viewerIsHost ? "Cancel this booking" : "Cancel this stay"}
                </Button>
              </div>
            </Card>
          ) : null}

          {cancelStay.isSuccess ? (
            <StatusMessage tone="info" title="This stay is canceled.">
              <p>{cancelStay.data.summary}</p>
            </StatusMessage>
          ) : null}
        </section>

        {/* --- review ----------------------------------------------- */}
        {booking.status === "completed" ? (
          <Surface padding="sm">
            <h2 className="m-0 text-base font-semibold">Your review</h2>
            <p className="mb-0 mt-2 text-sm text-ink-secondary">
              {booking.review.published
                ? "Both reviews are published."
                : booking.review.submitted
                  ? "Your review is written. Neither side sees the other's until both are in, or until the window closes."
                  : "Neither side sees the other's review until both are in, or until the window closes."}
            </p>
            <div className="mt-4">
              <ButtonLink to={`/review/${booking.id}`} variant="secondary" size="sm">
                {booking.review.submitted ? "See your review" : "Write your review"}
              </ButtonLink>
            </div>
          </Surface>
        ) : null}

        <Dialog
          open={confirmCancel}
          onClose={() => setConfirmCancel(false)}
          title={booking.viewerIsHost ? "Cancel this booking?" : "Cancel this stay?"}
          description={booking.cancellation.summary}
          size="sm"
        >
          <DataList>
            <DataRow label="Refund to the card" value={formatUsd(booking.cancellation.refundCents)} />
            <DataRow
              label="Deposit released"
              value={formatUsd(booking.cancellation.depositReleasedCents)}
            />
          </DataList>
          {cancelStay.isError ? (
            <div className="mt-4">
              <StatusMessage
                tone="danger"
                title={
                  cancelStay.error instanceof ApiError
                    ? cancelStay.error.message
                    : "We couldn't cancel this stay. Nothing has changed."
                }
              />
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="danger" busy={cancelStay.isPending} busyLabel="Canceling…" onClick={() => cancelStay.mutate()}>
              Confirm cancel
            </Button>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Keep this stay
            </Button>
          </div>
        </Dialog>
      </div>
    </Shell>
  );
}

/**
 * Check-in and checkout as a date plus the home's local time.
 *
 * The time comes from `app_config`; when it has not loaded the date stands on
 * its own rather than being paired with a guessed hour.
 */
function checkInLine(booking: TripDetail, checkinLocalTime: string | undefined): string {
  return checkinLocalTime
    ? `${prettyDay(booking.checkIn)}, from ${checkinLocalTime}`
    : prettyDay(booking.checkIn);
}

function checkOutLine(booking: TripDetail, checkoutLocalTime: string | undefined): string {
  return checkoutLocalTime
    ? `${prettyDay(booking.checkOut)}, by ${checkoutLocalTime}`
    : prettyDay(booking.checkOut);
}
