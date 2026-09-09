import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ExploreFilters, filtersFromSearch } from "../components/ExploreFilters";
import { ListingCard } from "../components/ListingCard";
import { SearchIcon } from "../components/Icons";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { api } from "../lib/api";
import { listingFiltersKey } from "../lib/filters";

export function ExplorePage() {
  const [searchParams] = useSearchParams();
  const filters = filtersFromSearch(searchParams);

  const catalog = useQuery({
    queryKey: ["listings", "active"],
    queryFn: () => api.listings(),
  });

  const listings = useQuery({
    queryKey: ["listings", "active", listingFiltersKey(filters)],
    queryFn: () => api.listings(filters),
  });

  const count = listings.data?.length;
  const emptyFiltered = Boolean(listings.data && listings.data.length === 0 && listingFiltersKey(filters));

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-4 px-[18px] pb-4 pt-16 md:pt-4">
        <div className="flex items-center gap-3 rounded-full bg-linen px-[18px] py-[13px]">
          <SearchIcon className="h-[19px] w-[19px] text-spruce" />
          <div className="flex flex-col">
            <span className="text-[15.5px] font-bold">Where to?</span>
            <span className="text-xs text-ink/55">Member homes · 30 nights or more</span>
          </div>
        </div>

        <ExploreFilters listings={catalog.data ?? []} filters={filters} />

        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink/55">
            {typeof count === "number"
              ? `${count} member ${count === 1 ? "home" : "homes"}`
              : "Member homes"}
          </span>
        </div>

        {listings.isLoading ? (
          <StatusBanner title="Loading member homes…" detail="Fetching active listings." />
        ) : null}
        {listings.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not load listings"
            detail={listings.error instanceof Error ? listings.error.message : "Try again shortly."}
          />
        ) : null}
        {listings.data && listings.data.length === 0 && !emptyFiltered ? (
          <StatusBanner
            title="No homes yet"
            detail="Run npm run db:seed against the database — one host, six listings across timezones."
          />
        ) : null}
        {emptyFiltered ? (
          <StatusBanner
            title="Nothing matches those filters"
            detail="Clear them, or widen the city, type, or nightly rate."
          />
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {listings.data?.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
