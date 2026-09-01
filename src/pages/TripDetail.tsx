import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { EscrowTimeline } from "../components/EscrowTimeline";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { prettyRange } from "../lib/dates";
import { api, ApiError } from "../lib/api";
import { formatUsd } from "../lib/money";

export function TripDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user, loading } = useAuth();

  const trip = useQuery({
    queryKey: ["trip", bookingId],
    enabled: Boolean(user) && Boolean(bookingId),
    queryFn: () => api.trip(bookingId as string),
    retry: false,
  });

  const booking = trip.data;
  const listing = booking?.listing;
  const photo = listing?.photos[0];
  const escrow = booking?.escrow;
  const notFound = trip.error instanceof ApiError && trip.error.status === 404;

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-3.5 px-[18px] pb-4 pt-16 md:pt-4">
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
                  <span className="text-xs text-ink/60">
                    {escrow?.state === "scheduled"
                      ? "Scheduled — held at listing-local check-in. Nobody can spend it meanwhile."
                      : `State: ${escrow?.state ?? "scheduled"}`}
                  </span>
                </div>
              </div>
              <EscrowTimeline activeIndex={0} />
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

            <p className="m-0 text-[12.5px] leading-relaxed text-ink/55">
              Messaging, claims, and reviews land in later slices. Checkout is 11:00 listing-local time — your
              review opens then. Double-blind, as always.
            </p>
            <Link to="/trips" className="text-sm font-bold no-underline">
              All trips →
            </Link>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
