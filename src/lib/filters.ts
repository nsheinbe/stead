/**
 * Explore query string. Parsed on both sides so a shareable /explore?city=
 * URL and GET /api/listings?city= mean the same thing.
 */
import type { ListingType } from "./types";

export const LISTING_TYPES: ListingType[] = ["entire_home", "apartment", "private_room"];

export type ListingFilters = {
  q?: string;
  city?: string;
  type?: ListingType;
  guests?: number;
  maxNightlyRateCents?: number;
  instantBook?: boolean;
};

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseListingFilters(
  raw: Record<string, string | string[] | undefined> | URLSearchParams,
): ListingFilters {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      const value = raw.get(key);
      return value && value.trim() ? value.trim() : undefined;
    }
    const value = firstString(raw[key]);
    return value && value.trim() ? value.trim() : undefined;
  };

  const q = get("q");
  const city = get("city");
  const typeRaw = get("type");
  const type = LISTING_TYPES.includes(typeRaw as ListingType) ? (typeRaw as ListingType) : undefined;

  const guestsRaw = get("guests");
  const guestsParsed = guestsRaw ? Number(guestsRaw) : Number.NaN;
  const guests =
    Number.isInteger(guestsParsed) && guestsParsed >= 1 && guestsParsed <= 50 ? guestsParsed : undefined;

  const maxRaw = get("maxRate");
  const maxParsed = maxRaw ? Number(maxRaw) : Number.NaN;
  const maxNightlyRateCents =
    Number.isInteger(maxParsed) && maxParsed >= 1 ? maxParsed : undefined;

  const instantRaw = get("instant");
  const instantBook = instantRaw === "1" || instantRaw === "true" ? true : undefined;

  return { q, city, type, guests, maxNightlyRateCents, instantBook };
}

export function listingFiltersToSearch(filters: ListingFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.city) params.set("city", filters.city);
  if (filters.type) params.set("type", filters.type);
  if (filters.guests) params.set("guests", String(filters.guests));
  if (filters.maxNightlyRateCents) params.set("maxRate", String(filters.maxNightlyRateCents));
  if (filters.instantBook) params.set("instant", "1");
  return params.toString();
}

export function listingFiltersKey(filters: ListingFilters): string {
  return listingFiltersToSearch(filters);
}
