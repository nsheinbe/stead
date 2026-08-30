import { Link } from "react-router-dom";
import { formatUsd } from "../lib/money";
import type { Listing } from "../lib/types";
import { BoltIcon } from "./Icons";

function photoUrl(listing: Listing): string {
  const photos = [...(listing.listing_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return photos[0]?.storage_path ?? `https://picsum.photos/seed/stead-${listing.id}/800/500`;
}

function amenityLine(listing: Listing): string {
  const bedrooms = listing.amenities.bedrooms;
  const place = listing.region ? `${listing.city}, ${listing.region}` : listing.city;
  const beds = bedrooms ? ` · ${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}` : "";
  return `${place} · Sleeps ${listing.max_guests}${beds}`;
}

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link
      to={`/listing/${listing.id}`}
      className="block overflow-hidden rounded-card border border-[#EDE5D4] bg-paper text-inherit no-underline shadow-card"
    >
      <div className="relative h-[186px] bg-linen">
        <img src={photoUrl(listing)} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="flex flex-col gap-1.5 px-4 pb-[15px] pt-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16.5px] font-bold">{listing.title}</span>
          <span className="money whitespace-nowrap text-[16.5px] font-bold">
            {formatUsd(listing.nightly_rate_cents)}{" "}
            <span className="text-[12.5px] font-medium text-ink/55">/ night</span>
          </span>
        </div>
        <span className="text-[13px] text-ink/55">{amenityLine(listing)}</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {listing.instant_book ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#E2D9C5] px-2.5 py-1 text-[11.5px] font-semibold text-ink/65">
              <BoltIcon />
              Instant book
            </span>
          ) : null}
          <span className="rounded-full bg-linen px-2.5 py-1 text-[11.5px] font-bold capitalize">
            {listing.cancellation_policy}
          </span>
        </div>
      </div>
    </Link>
  );
}
