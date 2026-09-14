import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CatalogEmptyActions, CATALOG_EMPTY_COPY } from "../components/CatalogEmpty";
import { ExploreFilters, filtersFromSearch } from "../components/ExploreFilters";
import { ListingCard, ListingCardSkeleton } from "../components/ListingCard";
import { Shell } from "../components/Shell";
import { Button, EmptyState, PageHeader, StatusMessage } from "../components/ui";
import { api } from "../lib/api";
import { exploreResultsView } from "../lib/exploreEmpty";
import { listingFiltersKey } from "../lib/filters";
import { MIN_STAY_NIGHTS } from "../lib/money";

/**
 * Results over the supported catalog filters. No map, no date availability
 * and no "available for your dates" claim: the API has none of those, and the
 * exclusion constraint is what settles availability, at booking time.
 */
export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearch(searchParams);
  const filterKey = listingFiltersKey(filters);
  const hasFilters = filterKey.length > 0;

  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  // The unfiltered catalog feeds the city list, so the choices do not collapse
  // to whatever the current filter already matched.
  const catalog = useQuery({
    queryKey: ["listings", "active"],
    queryFn: () => api.listings(),
  });

  const listings = useQuery({
    queryKey: ["listings", "active", filterKey],
    queryFn: () => api.listings(filters),
    // Previous results stay on screen while a new filter loads.
    placeholderData: (previous) => previous,
  });

  const feeBps = config.data?.networkFeeBps ?? null;
  const results = listings.data;
  const refreshing = listings.isFetching && !listings.isPending;
  const view = exploreResultsView({
    listingsPending: listings.isPending,
    listingsError: listings.isError,
    resultCount: results?.length,
    catalogPending: catalog.isPending,
    catalogCount: catalog.data?.length,
    hasFilters,
  });

  return (
    <Shell title="Find a home">
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-10">
        <PageHeader
          title="Find your next home"
          description={`Stays of ${MIN_STAY_NIGHTS} nights or more.`}
        />

        {view !== "catalog_empty" ? (
          <ExploreFilters
            listings={catalog.data ?? []}
            filters={filters}
            resultCount={results?.length}
            busy={refreshing}
          />
        ) : null}

        {view === "loading" ? (
          <>
            <p role="status" className="sr-only">
              Loading homes
            </p>
            <ul className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <li key={index}>
                  <ListingCardSkeleton />
                </li>
              ))}
            </ul>
          </>
        ) : view === "error" ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load homes. Please try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => void listings.refetch()}>
                Try again
              </Button>
            }
          >
            <p>Your filters are still here.</p>
          </StatusMessage>
        ) : view === "filters_empty" ? (
          <EmptyState
            title="No homes match these filters."
            action={
              <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams())}>
                Clear filters
              </Button>
            }
          >
            <p>Try another location or adjust your filters.</p>
          </EmptyState>
        ) : view === "catalog_empty" ? (
          <EmptyState
            title={CATALOG_EMPTY_COPY.title}
            testId="explore-empty-catalog"
            action={<CatalogEmptyActions />}
          >
            <p>{CATALOG_EMPTY_COPY.body}</p>
          </EmptyState>
        ) : (
          <ul
            className={`m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 ${
              refreshing ? "opacity-60" : ""
            }`}
            aria-busy={refreshing}
          >
            {results?.map((listing, index) => (
              <li key={listing.id}>
                <ListingCard listing={listing} networkFeeBps={feeBps} priority={index < 3} />
              </li>
            ))}
          </ul>
        )}

        <p className="m-0 max-w-reading text-sm text-ink-secondary">
          Prices are an estimate for {MIN_STAY_NIGHTS} nights, so homes can be compared. Choose dates on a home's
          page for its exact price. Filters do not check date availability.
        </p>
      </div>
    </Shell>
  );
}
