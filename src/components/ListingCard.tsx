import { Link } from "react-router-dom";
import { estimateLabel, estimateMinimumStay, nightlyOnlyLabel } from "../lib/estimate";
import { formatUsd, MIN_STAY_NIGHTS } from "../lib/money";
import { TYPE_LABEL, type ListingSummary } from "../lib/types";
import { ListingPhoto } from "./ListingPhoto";

/**
 * One home in a results grid.
 *
 * One link wraps the whole card, so there is a single clear target and no
 * nested interactive elements. The price is the shared minimum-stay estimate
 * with its basis spelled out; there is no rating, no wishlist and no
 * availability badge, because none of those exist in the listing contract.
 */
export function ListingCard({
  listing,
  networkFeeBps,
  priority = false,
}: {
  listing: ListingSummary;
  networkFeeBps: number | null | undefined;
  /** Eager-load the first row's images; everything else is lazy. */
  priority?: boolean;
}) {
  const estimate = estimateMinimumStay(listing.nightlyRateCents, networkFeeBps);
  const place = listing.region ? `${listing.city}, ${listing.region}` : listing.city;
  const bedrooms = listing.amenities.bedrooms;

  return (
    <article className="group">
      <Link
        to={`/listing/${listing.id}`}
        className="flex h-full flex-col rounded-card text-inherit no-underline focus-visible:outline-offset-2"
      >
        <ListingPhoto
          src={listing.photos[0]?.storagePath}
          alt=""
          aspect="4/3"
          className="rounded-card"
          sizes="(min-width: 1024px) 380px, (min-width: 650px) 45vw, 90vw"
          priority={priority}
        />
        <div className="flex flex-1 flex-col gap-1 pt-3">
          <p className="m-0 text-metadata font-semibold uppercase tracking-[0.1em] text-ink-secondary">{place}</p>
          <h3 className="m-0 text-card-title group-hover:text-brand">{listing.title}</h3>
          <p className="m-0 text-sm text-ink-secondary">
            {TYPE_LABEL[listing.type]} · Sleeps {listing.maxGuests}
            {bedrooms ? ` · ${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}` : ""}
          </p>
          <div className="mt-auto pt-2">
            {estimate ? (
              <>
                <p className="money m-0 font-semibold">{estimateLabel(estimate)}</p>
                <p className="m-0 text-sm text-ink-secondary">
                  {formatUsd(listing.nightlyRateCents)} per night, fee included. Deposit separate.
                </p>
              </>
            ) : (
              <>
                <p className="money m-0 font-semibold">{nightlyOnlyLabel(listing.nightlyRateCents)}</p>
                <p className="m-0 text-sm text-ink-secondary">
                  Fees shown at checkout. Stays of {MIN_STAY_NIGHTS} nights or more.
                </p>
              </>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}

/** Matches the card's proportions so the grid does not jump when data lands. */
export function ListingCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="aspect-[4/3] w-full animate-pulse rounded-card bg-surface motion-reduce:animate-none" />
      <div className="flex flex-col gap-2 pt-3">
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface motion-reduce:animate-none" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-surface motion-reduce:animate-none" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-surface motion-reduce:animate-none" />
        <div className="h-5 w-2/5 animate-pulse rounded bg-surface motion-reduce:animate-none" />
      </div>
    </div>
  );
}
