import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DepositChip, PriceBreakdown } from "../components/PriceBreakdown";
import { BackChevron, BoltIcon } from "../components/Icons";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { api, ApiError } from "../lib/api";
import { formatUsd, MIN_STAY_NIGHTS, quoteStay } from "../lib/money";

const PREVIEW_NIGHTS = MIN_STAY_NIGHTS;

export function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [photoIndex, setPhotoIndex] = useState(0);

  const listingQuery = useQuery({
    queryKey: ["listing", id],
    enabled: Boolean(id),
    queryFn: () => api.listing(id as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const listing = listingQuery.data;
  const photos = listing?.photos ?? [];
  const host = listing?.host ?? null;
  const feeBps = configQuery.data?.networkFeeBps ?? 200;
  const quote = listing
    ? quoteStay({
        nightlyRateCents: listing.nightlyRateCents,
        nights: PREVIEW_NIGHTS,
        networkFeeBps: feeBps,
        depositCents: listing.depositCents,
      })
    : null;

  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;

  const amenityBits = listing
    ? [
        listing.region
          ? `${listing.city}, ${listing.region === listing.city ? listing.country : listing.region}`
          : listing.city,
        `Sleeps ${listing.maxGuests}`,
        listing.amenities.bedrooms ? `${listing.amenities.bedrooms} bed` : null,
        listing.amenities.wifi ? "Wifi" : null,
        listing.amenities.kitchen ? "Kitchen" : null,
        listing.amenities.fireplace ? "Fireplace" : null,
      ].filter(Boolean)
    : [];

  return (
    <Shell hideNav>
      {listingQuery.isLoading ? (
        <div className="p-6">
          <StatusBanner title="Loading the home…" />
        </div>
      ) : null}
      {notFound ? (
        <div className="p-6">
          <StatusBanner title="No listing here" detail="It may be paused, or the link is stale." />
        </div>
      ) : null}
      {listingQuery.isError && !notFound ? (
        <div className="p-6">
          <StatusBanner tone="claim" title="This listing could not be loaded" />
        </div>
      ) : null}

      {listing && quote ? (
        <div className="flex flex-1 flex-col">
          <div className="relative h-[290px] shrink-0 bg-linen">
            <img
              src={photos[photoIndex]?.storagePath ?? `https://picsum.photos/seed/stead-${listing.id}/1200/800`}
              alt=""
              className="h-full w-full object-cover"
            />
            <Link
              to="/explore"
              aria-label="Back to explore"
              className="absolute left-3.5 top-16 flex h-10 w-10 items-center justify-center rounded-full bg-paper/92 no-underline shadow-[0_2px_8px_rgba(23,32,27,.18)]"
            >
              <BackChevron />
            </Link>
            {photos.length > 1 ? (
              <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                {photos.map((photo, i) => (
                  <button
                    key={photo.id}
                    type="button"
                    aria-label={`Photo ${i + 1}`}
                    className={`pointer-events-auto h-1.5 w-1.5 rounded-full ${
                      i === photoIndex ? "bg-paper" : "bg-paper/45"
                    }`}
                    onClick={() => setPhotoIndex(i)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-1 flex-col gap-3.5 px-[18px] py-[18px]">
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 font-display text-2xl font-semibold leading-tight">{listing.title}</h1>
              <p className="m-0 text-[13.5px] text-ink/55">{amenityBits.join(" · ")}</p>
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {listing.instantBook ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#E2D9C5] px-2.5 py-1 text-[11.5px] font-semibold text-ink/65">
                    <BoltIcon />
                    Instant book
                  </span>
                ) : null}
                <span className="rounded-full bg-linen px-2.5 py-1 text-[11.5px] font-bold capitalize">
                  {listing.cancellationPolicy} cancellation
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-[14px] bg-linen px-3.5 py-3">
              <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-brass bg-spruce text-[15px] font-bold text-paper">
                {(host?.displayName ?? "H").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14.5px] font-bold">Hosted by {host?.displayName ?? "a member"}</span>
                <span className="text-xs text-ink/55">
                  {listing.timezone} · hosts list here because they keep more at 2%
                </span>
              </div>
            </div>

            <p className="m-0 text-sm leading-relaxed text-ink/75">{listing.description}</p>

            <PriceBreakdown
              nightlyRateCents={quote.nightly_rate_cents}
              nights={quote.nights}
              staySubtotalCents={quote.stay_subtotal_cents}
              networkFeeCents={quote.network_fee_cents}
              guestTotalCents={quote.guest_total_cents}
            />
            <DepositChip amountCents={listing.depositCents} />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[#EDE6D6] bg-paper px-[18px] pb-7 pt-3.5">
            <div className="flex flex-col">
              <span className="money text-base font-bold">{formatUsd(quote.guest_total_cents)} total</span>
              <span className="text-[11.5px] text-ink/55">
                {PREVIEW_NIGHTS}-night stay · shown as arithmetic
              </span>
            </div>
            <Link
              to={`/book/${listing.id}`}
              className="inline-flex items-center rounded-xl bg-spruce px-6 py-[15px] text-[15px] font-bold text-paper no-underline hover:bg-spruce-deep hover:text-paper"
            >
              {listing.instantBook ? "Book this stay" : "Request to book"}
            </Link>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
