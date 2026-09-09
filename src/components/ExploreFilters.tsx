import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { LISTING_TYPES, parseListingFilters, type ListingFilters } from "../lib/filters";
import { formatUsd } from "../lib/money";
import { TYPE_LABEL, type ListingSummary } from "../lib/types";

function uniqueCities(listings: ListingSummary[]): string[] {
  return [...new Set(listings.map((l) => l.city))].sort((a, b) => a.localeCompare(b));
}

export function ExploreFilters({
  listings,
  filters,
}: {
  listings: ListingSummary[];
  filters: ListingFilters;
}) {
  const [, setSearchParams] = useSearchParams();
  const cities = useMemo(() => uniqueCities(listings), [listings]);

  function patch(next: Partial<ListingFilters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.city) params.set("city", merged.city);
    if (merged.type) params.set("type", merged.type);
    if (merged.guests) params.set("guests", String(merged.guests));
    if (merged.maxNightlyRateCents) params.set("maxRate", String(merged.maxNightlyRateCents));
    if (merged.instantBook) params.set("instant", "1");
    setSearchParams(params, { replace: true });
  }

  const activeCount = [
    filters.q,
    filters.city,
    filters.type,
    filters.guests,
    filters.maxNightlyRateCents,
    filters.instantBook,
  ].filter(Boolean).length;

  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-linen p-4"
      onSubmit={(e) => e.preventDefault()}
      aria-label="Filter member homes"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="explore-q" className="text-[11px] font-bold tracking-wider text-ink/50">
          WHERE TO
        </label>
        <input
          id="explore-q"
          type="search"
          value={filters.q ?? ""}
          placeholder="City, region, or a home's name"
          onChange={(e) => patch({ q: e.target.value || undefined })}
          className="rounded-xl border border-linen-tint bg-paper px-4 py-3 text-[15px]"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="explore-city" className="text-[11px] font-bold tracking-wider text-ink/50">
            CITY
          </label>
          <select
            id="explore-city"
            value={filters.city ?? ""}
            onChange={(e) => patch({ city: e.target.value || undefined })}
            className="rounded-xl border border-linen-tint bg-paper px-3 py-3 text-[15px]"
          >
            <option value="">Any city</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="explore-type" className="text-[11px] font-bold tracking-wider text-ink/50">
            HOME TYPE
          </label>
          <select
            id="explore-type"
            value={filters.type ?? ""}
            onChange={(e) =>
              patch({ type: (e.target.value || undefined) as ListingFilters["type"] })
            }
            className="rounded-xl border border-linen-tint bg-paper px-3 py-3 text-[15px]"
          >
            <option value="">Any type</option>
            {LISTING_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="explore-guests" className="text-[11px] font-bold tracking-wider text-ink/50">
            GUESTS
          </label>
          <input
            id="explore-guests"
            type="number"
            min={1}
            max={50}
            inputMode="numeric"
            value={filters.guests ?? ""}
            placeholder="Sleeps at least"
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ guests: Number.isInteger(n) && n >= 1 ? n : undefined });
            }}
            className="rounded-xl border border-linen-tint bg-paper px-4 py-3 text-[15px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="explore-rate" className="text-[11px] font-bold tracking-wider text-ink/50">
            MAX NIGHTLY RATE
          </label>
          <input
            id="explore-rate"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={filters.maxNightlyRateCents ? filters.maxNightlyRateCents / 100 : ""}
            placeholder="Dollars a night"
            onChange={(e) => {
              const dollars = Number(e.target.value);
              patch({
                maxNightlyRateCents:
                  Number.isInteger(dollars) && dollars >= 1 ? dollars * 100 : undefined,
              });
            }}
            className="rounded-xl border border-linen-tint bg-paper px-4 py-3 text-[15px]"
          />
          {filters.maxNightlyRateCents ? (
            <span className="money text-xs text-ink/55">
              Up to {formatUsd(filters.maxNightlyRateCents)} a night
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={Boolean(filters.instantBook)}
            onChange={(e) => patch({ instantBook: e.target.checked || undefined })}
            className="h-4 w-4 accent-spruce"
          />
          Instant book only
        </label>
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
            className="text-sm font-bold text-spruce hover:text-brass"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function filtersFromSearch(search: URLSearchParams): ListingFilters {
  return parseListingFilters(search);
}
