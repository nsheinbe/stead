import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LISTING_TYPES, parseListingFilters, type ListingFilters } from "../lib/filters";
import { formatUsd } from "../lib/money";
import { TYPE_LABEL, type ListingSummary } from "../lib/types";
import { Button, Checkbox, Dialog, Select, TextInput } from "./ui";

function uniqueCities(listings: ListingSummary[]): string[] {
  return [...new Set(listings.map((l) => l.city))].sort((a, b) => a.localeCompare(b));
}

function toParams(filters: ListingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.city) params.set("city", filters.city);
  if (filters.type) params.set("type", filters.type);
  if (filters.guests) params.set("guests", String(filters.guests));
  if (filters.maxNightlyRateCents) params.set("maxRate", String(filters.maxNightlyRateCents));
  if (filters.instantBook) params.set("instant", "1");
  return params;
}

/** Human labels for the chips, so a filter can be removed by name. */
function activeChips(filters: ListingFilters): { key: keyof ListingFilters; label: string }[] {
  const chips: { key: keyof ListingFilters; label: string }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”` });
  if (filters.city) chips.push({ key: "city", label: filters.city });
  if (filters.type) chips.push({ key: "type", label: TYPE_LABEL[filters.type] });
  if (filters.guests) chips.push({ key: "guests", label: `${filters.guests}+ guests` });
  if (filters.maxNightlyRateCents) {
    chips.push({ key: "maxNightlyRateCents", label: `Up to ${formatUsd(filters.maxNightlyRateCents)} a night` });
  }
  if (filters.instantBook) chips.push({ key: "instantBook", label: "Instant book" });
  return chips;
}

/**
 * Search and filters over the supported listing query only: text, city, type,
 * party size, nightly ceiling and instant book. There is no date field here —
 * the catalog has no availability index, and a date control would imply one.
 *
 * The URL is the source of truth, so a shared link and the Back button both
 * restore exactly what someone was looking at. The narrow layout collects the
 * secondary filters into a focus-managed sheet with explicit Apply and Clear.
 */
export function ExploreFilters({
  listings,
  filters,
  resultCount,
  busy,
}: {
  listings: ListingSummary[];
  filters: ListingFilters;
  resultCount: number | undefined;
  busy: boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  const cities = useMemo(() => uniqueCities(listings), [listings]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState(filters.q ?? "");
  // Edits inside the sheet are staged; nothing applies until Apply is pressed.
  const [staged, setStaged] = useState<ListingFilters>(filters);

  useEffect(() => setQuery(filters.q ?? ""), [filters.q]);
  useEffect(() => setStaged(filters), [filters]);

  function apply(next: ListingFilters) {
    setSearchParams(toParams(next), { replace: false });
  }

  function remove(key: keyof ListingFilters) {
    apply({ ...filters, [key]: undefined });
  }

  const chips = activeChips(filters);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        aria-label="Search homes"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ ...filters, q: query.trim() || undefined });
        }}
      >
        <TextInput
          label="Where would you like to stay?"
          id="explore-q"
          type="search"
          value={query}
          placeholder="City, region, or a home's name"
          onChange={(event) => setQuery(event.target.value)}
          wrapperClassName="flex-1"
        />
        <div className="flex gap-3">
          <Button type="submit" busy={busy} busyLabel="Searching…">
            Search
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSheetOpen(true)}>
            Filters
            {chips.length > 0 ? (
              <span className="money ml-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[0.6875rem] font-bold leading-5 text-white">
                {chips.length}
              </span>
            ) : null}
          </Button>
        </div>
      </form>

      {/* Desktop keeps the common filters in reach; the sheet holds all of them. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-4">
        <Select
          label="City"
          id="explore-city"
          value={filters.city ?? ""}
          onChange={(event) => apply({ ...filters, city: event.target.value || undefined })}
        >
          <option value="">Any city</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </Select>
        <Select
          label="Home type"
          id="explore-type"
          value={filters.type ?? ""}
          onChange={(event) =>
            apply({ ...filters, type: (event.target.value || undefined) as ListingFilters["type"] })
          }
        >
          <option value="">Any type</option>
          {LISTING_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </Select>
        <TextInput
          label="Guests"
          id="explore-guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          placeholder="Any"
          value={filters.guests ?? ""}
          onChange={(event) => {
            const n = Number.parseInt(event.target.value, 10);
            apply({ ...filters, guests: Number.isInteger(n) && n >= 1 ? n : undefined });
          }}
        />
        <TextInput
          label="Max nightly rate"
          id="explore-rate"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Any"
          hint="Whole dollars a night."
          value={filters.maxNightlyRateCents ? filters.maxNightlyRateCents / 100 : ""}
          onChange={(event) => {
            const dollars = Number.parseInt(event.target.value, 10);
            apply({
              ...filters,
              maxNightlyRateCents: Number.isInteger(dollars) && dollars >= 1 ? dollars * 100 : undefined,
            });
          }}
        />
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Filters:</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => remove(chip.key)}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-full bg-surface-accent px-3 text-sm font-semibold text-brand hover:bg-surface"
            >
              {chip.label}
              <span aria-hidden>×</span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <Button variant="quiet" size="sm" onClick={() => setSearchParams(new URLSearchParams(), { replace: false })}>
            Clear filters
          </Button>
        </div>
      ) : null}

      {/* Announced without stealing focus from the control that changed. */}
      <p role="status" className="m-0 text-sm text-ink-secondary">
        {busy
          ? "Updating results…"
          : typeof resultCount === "number"
            ? `${resultCount} ${resultCount === 1 ? "home" : "homes"}`
            : ""}
      </p>

      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        variant="sheet"
        closeLabel="Close filters"
      >
        <div className="flex flex-col gap-5">
          <Select
            label="City"
            value={staged.city ?? ""}
            onChange={(event) => setStaged({ ...staged, city: event.target.value || undefined })}
          >
            <option value="">Any city</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>
          <Select
            label="Home type"
            value={staged.type ?? ""}
            onChange={(event) =>
              setStaged({ ...staged, type: (event.target.value || undefined) as ListingFilters["type"] })
            }
          >
            <option value="">Any type</option>
            {LISTING_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
          <TextInput
            label="Guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            placeholder="Any"
            value={staged.guests ?? ""}
            onChange={(event) => {
              const n = Number.parseInt(event.target.value, 10);
              setStaged({ ...staged, guests: Number.isInteger(n) && n >= 1 ? n : undefined });
            }}
          />
          <TextInput
            label="Max nightly rate"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Any"
            hint="Whole dollars a night."
            value={staged.maxNightlyRateCents ? staged.maxNightlyRateCents / 100 : ""}
            onChange={(event) => {
              const dollars = Number.parseInt(event.target.value, 10);
              setStaged({
                ...staged,
                maxNightlyRateCents: Number.isInteger(dollars) && dollars >= 1 ? dollars * 100 : undefined,
              });
            }}
          />
          <Checkbox
            label="Instant book only"
            hint="Homes that confirm without waiting for the host."
            checked={Boolean(staged.instantBook)}
            onChange={(event) => setStaged({ ...staged, instantBook: event.target.checked || undefined })}
          />
          <div className="flex flex-wrap gap-3 border-t border-divider pt-4">
            <Button
              onClick={() => {
                apply(staged);
                setSheetOpen(false);
              }}
            >
              Apply filters
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStaged({});
                setSearchParams(new URLSearchParams(), { replace: false });
                setSheetOpen(false);
              }}
            >
              Clear all
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function filtersFromSearch(search: URLSearchParams): ListingFilters {
  return parseListingFilters(search);
}
