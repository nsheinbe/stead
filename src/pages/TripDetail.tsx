import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CancellationPolicyCard } from "../components/CancellationPolicyCard";
import { EscrowTimeline } from "../components/EscrowTimeline";
import { InboxIcon } from "../components/Icons";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { prettyRange } from "../lib/dates";
import { api, ApiError } from "../lib/api";
import { dollarsToCents } from "../lib/cents";
import { formatUsd } from "../lib/money";
import { CLAIM_STATE_LABEL } from "../lib/types";

export function TripDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const trip = useQuery({
    queryKey: ["trip", bookingId],
    enabled: Boolean(user) && Boolean(bookingId),
    queryFn: () => api.trip(bookingId as string),
    retry: false,
  });

  const file = useMutation({
    mutationFn: () => {
      const amountCents = dollarsToCents(amount);
      if (amountCents == null || amountCents < 1 || !bookingId) {
        throw new ApiError(400, "Enter a dollar amount at or under the deposit");
      }
      return api.fileClaim({ bookingId, amountCents, description });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
    },
  });

  const cancelStay = useMutation({
    mutationFn: () => {
      if (!bookingId) throw new ApiError(400, "Missing stay");
      return api.cancelTrip(bookingId);
    },
    onSuccess: async () => {
      setConfirmCancel(false);
      await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });

  const respond = useMutation({
    mutationFn: (accept: boolean) => {
      const id = trip.data?.claim?.id;
      if (!id) throw new ApiError(400, "No claim on this stay");
      return api.respondClaim(id, accept);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
    },
  });

  const booking = trip.data;
  const listing = booking?.listing;
  const photo = listing?.photos[0];
  const escrow = booking?.escrow;
  const notFound = trip.error instanceof ApiError && trip.error.status === 404;

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Your stay</h1>
          {booking ? (
            <span className="rounded-full bg-linen px-3 py-1.5 text-xs font-bold capitalize">
              {booking.status.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>

        {loading || trip.isLoading ? <StatusBanner title="Loading this stay…" /> : null}
        {user && notFound ? (
          <StatusBanner
            title="Trip not found"
            detail="Guest A cannot read guest B's booking — that is the rule."
          />
        ) : null}
        {!user && !loading ? <StatusBanner title="Sign in to see this trip" /> : null}

        {booking && listing ? (
          <>
            <div className="flex items-center gap-3 rounded-[14px] border border-linen-tint px-3.5 py-3">
              <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[10px] bg-linen">
                {photo ? <img src={photo.storagePath} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold">{listing.title}</span>
                <span className="text-xs text-ink/55">
                  {prettyRange(booking.checkIn, booking.checkOut)} · {listing.city}
                  {listing.region ? `, ${listing.region}` : ""}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-card bg-linen p-[18px]">
              <span className="text-[11.5px] font-bold tracking-[0.14em] text-ink/50">ACCESS</span>
              <p className="m-0 text-[12.5px] leading-relaxed text-ink/60">
                Check-in {booking.checkIn} at listing-local time ({listing.timezone}). The host shares the door
                details before you arrive — Slice 1 does not invent a code.
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-dashed border-brass/75 bg-brass/[0.06] px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="money text-sm font-bold">
                    {formatUsd(escrow?.amountCents ?? booking.depositCents)} · in escrow
                  </span>
                </div>
              </div>
              <EscrowTimeline escrow={escrow ?? null} timezone={listing.timezone} />
            </div>

            <div className="flex flex-col gap-2 rounded-[14px] border border-linen-tint px-4 py-3.5 text-sm">
              <div className="money flex justify-between">
                <span className="text-ink/70">Stay + 2% network fee</span>
                <span className="font-semibold">{formatUsd(booking.guestTotalCents)}</span>
              </div>
              <div className="money flex justify-between">
                <span className="text-ink/70">Deposit (apart)</span>
                <span className="font-semibold">{formatUsd(booking.depositCents)}</span>
              </div>
            </div>

            <div className="flex gap-2.5">
              <Link
                to={`/messages/${listing.id}/${booking.guest.id}`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-spruce py-3.5 text-[14px] font-bold text-paper no-underline hover:bg-spruce-deep hover:text-paper"
              >
                <InboxIcon className="h-4 w-4" />
                Message {booking.viewerIsHost ? booking.guest.displayName : booking.host.displayName}
              </Link>
            </div>

            <CancellationPolicyCard policy={booking.cancellationPolicy} compact />

            {booking.cancellation.canCancel ? (
              <div className="flex flex-col gap-2.5 rounded-[14px] border border-linen-tint px-4 py-3.5">
                <span className="text-sm font-bold">
                  {booking.viewerIsHost ? "Cancel this booking" : "Cancel this stay"}
                </span>
                <p className="m-0 text-[12.5px] leading-relaxed text-ink/70" data-testid="cancel-preview-summary">
                  {booking.cancellation.summary}
                </p>
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="money flex justify-between">
                    <span className="text-ink/70">Refund to card</span>
                    <span className="font-semibold" data-testid="cancel-preview-refund">
                      {formatUsd(booking.cancellation.refundCents)}
                    </span>
                  </div>
                  <div className="money flex justify-between">
                    <span className="text-ink/70">Deposit released</span>
                    <span className="font-semibold">{formatUsd(booking.cancellation.depositReleasedCents)}</span>
                  </div>
                </div>
                {confirmCancel ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={cancelStay.isPending}
                      onClick={() => cancelStay.mutate()}
                      className="rounded-full bg-claim px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                    >
                      {cancelStay.isPending ? "Canceling…" : "Confirm cancel"}
                    </button>
                    <button
                      type="button"
                      disabled={cancelStay.isPending}
                      onClick={() => setConfirmCancel(false)}
                      className="rounded-full border border-[#D8CDB6] px-4 py-2 text-sm font-bold"
                    >
                      Keep this stay
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="self-start rounded-full border border-[#D8CDB6] px-4 py-2 text-sm font-bold"
                  >
                    {booking.viewerIsHost ? "Cancel booking" : "Cancel this stay"}
                  </button>
                )}
                {cancelStay.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not cancel"
                    detail={cancelStay.error instanceof ApiError ? cancelStay.error.message : undefined}
                  />
                ) : null}
                {cancelStay.isSuccess ? (
                  <StatusBanner title="Canceled" detail={cancelStay.data.summary} />
                ) : null}
              </div>
            ) : null}

            {booking.claim ? (
              <div
                className={`flex flex-col gap-2 rounded-card px-4 py-3.5 ${
                  booking.claim.state === "guest_disputed" || booking.claim.state === "open"
                    ? "bg-claim/10"
                    : "bg-linen"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">
                    Claim · {formatUsd(booking.claim.amountCents)}
                  </span>
                  <span className="text-[11.5px] font-bold tracking-[0.1em] text-ink/50">
                    {CLAIM_STATE_LABEL[booking.claim.state].toUpperCase()}
                  </span>
                </div>
                <p className="m-0 text-[12.5px] leading-relaxed text-ink/70">
                  {booking.claim.description}
                </p>
                {!booking.viewerIsHost && booking.claim.state === "open" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => respond.mutate(true)}
                      disabled={respond.isPending}
                      className="rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                    >
                      Accept claim
                    </button>
                    <button
                      type="button"
                      onClick={() => respond.mutate(false)}
                      disabled={respond.isPending}
                      className="rounded-full border border-claim/40 px-4 py-2 text-sm font-bold text-claim disabled:opacity-60"
                    >
                      Dispute
                    </button>
                  </div>
                ) : null}
                <Link to={`/host/claims/${booking.claim.id}`} className="text-sm font-bold no-underline">
                  Claim detail →
                </Link>
                {respond.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not record that"
                    detail={respond.error instanceof ApiError ? respond.error.message : undefined}
                  />
                ) : null}
              </div>
            ) : booking.viewerIsHost && escrow?.state === "claim_window" ? (
              <form
                className="flex flex-col gap-3 rounded-card border-[1.5px] border-dashed border-claim/40 p-[18px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  file.mutate();
                }}
              >
                <span className="text-sm font-bold">File a claim</span>
                <p className="m-0 text-[12.5px] leading-relaxed text-ink/60">
                  Amount cannot exceed the {formatUsd(escrow.amountCents)} deposit, and the window is still
                  open.
                </p>
                <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                  AMOUNT
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="150.00"
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                  WHAT HAPPENED
                  <textarea
                    required
                    minLength={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <button
                  type="submit"
                  disabled={file.isPending}
                  className="self-start rounded-full bg-claim px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                >
                  {file.isPending ? "Filing…" : "File claim"}
                </button>
                {file.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not file that claim"
                    detail={file.error instanceof ApiError ? file.error.message : undefined}
                  />
                ) : null}
              </form>
            ) : null}

            <div className="flex items-center justify-between gap-2.5 border-t border-[#EDE6D6] pt-3">
              <span className="text-[12.5px] leading-snug text-ink/55">
                {booking.status === "completed"
                  ? booking.review.published
                    ? "Reviews are published — both sides, at once."
                    : booking.review.submitted
                      ? "Your review is in. It publishes when the other side writes theirs, or in 14 days."
                      : "Checkout is done — your review is open. Double-blind, as always."
                  : "Checkout is 11:00 listing-local time — your review opens then. Double-blind, as always."}
              </span>
              {booking.status === "completed" ? (
                <Link
                  to={`/review/${booking.id}`}
                  className="whitespace-nowrap text-[12.5px] font-bold no-underline"
                >
                  {booking.review.submitted ? "See review →" : "Write review →"}
                </Link>
              ) : null}
            </div>
            <Link to="/trips" className="text-sm font-bold no-underline">
              All trips →
            </Link>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
