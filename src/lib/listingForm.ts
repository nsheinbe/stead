/**
 * The listing editor's data contract.
 *
 * The editor used to hydrate from the dashboard summary (`HostListing`), which
 * carries seven of a listing's sixteen editable fields. Description, type,
 * address, region, amenities and the rest were never loaded, so they could not
 * be edited — and any code that rebuilt an input from that summary would send
 * empty defaults over real data.
 *
 * Two rules keep that from recurring:
 *
 *  1. Hydration reads `ListingDetail` (`GET /api/listings/:id`), which the
 *     server already lets an owner read for their own draft or paused home.
 *     `listingFormFromDetail` -> `listingFormToInput` is a lossless round trip,
 *     and `tests/listing-form.test.ts` asserts exactly that.
 *  2. Saving sends `diffListingInput`, not the whole form. An untouched field
 *     is absent from the PATCH body rather than resent, so a field this editor
 *     does not know about — or a value another tab changed meanwhile — is not
 *     overwritten by what the page happened to load.
 *
 * Money is a string here and becomes cents through `dollarsToCents`. The old
 * editor did `Math.round(Number(value) * 100)`, which is the float path the
 * money rules forbid.
 */
import { dollarsToCents } from "./cents";
import type {
  CancellationPolicy,
  ListingAmenities,
  ListingDetail,
  ListingInput,
  ListingType,
} from "./types";

/** Editable state. Every value is a string or boolean, because it comes from a form control. */
export type ListingFormValues = {
  title: string;
  description: string;
  type: ListingType;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  /** Dollars as typed, e.g. "200" or "199.50". */
  nightlyRate: string;
  deposit: string;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  wifi: boolean;
  kitchen: boolean;
  fireplace: boolean;
  courtyard: boolean;
  instantBook: boolean;
  cancellationPolicy: CancellationPolicy;
};

export type ListingFormField = keyof ListingFormValues;

export type ListingFormErrors = Partial<Record<ListingFormField, string>>;

export type ListingFormResult =
  | { ok: true; input: ListingInput }
  | { ok: false; errors: ListingFormErrors };

/** Cents to a plain dollars string. 20000 -> "200", 19950 -> "199.50". */
export function centsToDollarsInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

function countToInput(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

/** Hydrate the editor from what the server actually holds. */
export function listingFormFromDetail(listing: ListingDetail): ListingFormValues {
  const a = listing.amenities ?? {};
  return {
    title: listing.title,
    description: listing.description,
    type: listing.type,
    addressLine: listing.addressLine,
    city: listing.city,
    region: listing.region,
    country: listing.country,
    timezone: listing.timezone,
    nightlyRate: centsToDollarsInput(listing.nightlyRateCents),
    deposit: centsToDollarsInput(listing.depositCents),
    maxGuests: String(listing.maxGuests),
    bedrooms: countToInput(a.bedrooms),
    beds: countToInput(a.beds),
    wifi: a.wifi === true,
    kitchen: a.kitchen === true,
    fireplace: a.fireplace === true,
    courtyard: a.courtyard === true,
    instantBook: listing.instantBook,
    cancellationPolicy: listing.cancellationPolicy,
  };
}

/**
 * Whether the browser recognises this as an IANA zone.
 *
 * The same check the server runs. Time zone is load-bearing: the escrow crons
 * convert check-in and checkout with `AT TIME ZONE listings.timezone`, so an
 * unknown zone raises inside a scheduled job rather than in front of the host.
 */
export function isValidTimeZone(value: string): boolean {
  if (value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseCount(raw: string, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
}

/**
 * Validate and convert to the server's input shape.
 *
 * These bounds mirror `listingSchema` in `server/routes/listings.ts`. The
 * server is still the authority — this exists so a host sees the problem next
 * to the field instead of as one API message at the top of the page.
 */
export function listingFormToInput(values: ListingFormValues): ListingFormResult {
  const errors: ListingFormErrors = {};

  const title = values.title.trim();
  if (title.length < 3) errors.title = "Give the home a name of at least 3 characters.";
  else if (title.length > 140) errors.title = "Keep the name to 140 characters or fewer.";

  const description = values.description.trim();
  if (description.length > 4000) errors.description = "Keep the description to 4,000 characters or fewer.";

  const addressLine = values.addressLine.trim();
  if (addressLine.length > 240) errors.addressLine = "Keep the address to 240 characters or fewer.";

  const city = values.city.trim();
  if (city.length === 0) errors.city = "Enter the city this home is in.";
  else if (city.length > 140) errors.city = "Keep the city to 140 characters or fewer.";

  const region = values.region.trim();
  if (region.length > 140) errors.region = "Keep the state or region to 140 characters or fewer.";

  const country = values.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.country = "Use the two-letter country code, such as US.";

  const timezone = values.timezone.trim();
  if (!isValidTimeZone(timezone)) {
    errors.timezone = "Use an IANA time zone, such as America/New_York.";
  }

  const nightlyRateCents = dollarsToCents(values.nightlyRate);
  if (nightlyRateCents === null) errors.nightlyRate = "Enter an amount in dollars, such as 200 or 199.50.";
  else if (nightlyRateCents < 1) errors.nightlyRate = "The nightly rate must be at least $0.01.";
  else if (nightlyRateCents > 100_000_000) errors.nightlyRate = "That nightly rate is too high.";

  const depositCents = dollarsToCents(values.deposit);
  if (depositCents === null) errors.deposit = "Enter an amount in dollars, such as 300 or 0.";
  else if (depositCents > 100_000_000) errors.deposit = "That deposit is too high.";

  const maxGuests = parseCount(values.maxGuests, 50);
  if (maxGuests === null || maxGuests < 1) errors.maxGuests = "Enter how many people the home sleeps, from 1 to 50.";

  const bedrooms = values.bedrooms.trim() === "" ? undefined : parseCount(values.bedrooms, 50);
  if (bedrooms === null) errors.bedrooms = "Enter a whole number of bedrooms, from 0 to 50.";

  const beds = values.beds.trim() === "" ? undefined : parseCount(values.beds, 50);
  if (beds === null) errors.beds = "Enter a whole number of beds, from 0 to 50.";

  if (
    Object.keys(errors).length > 0 ||
    nightlyRateCents === null ||
    depositCents === null ||
    maxGuests === null ||
    bedrooms === null ||
    beds === null
  ) {
    return { ok: false, errors };
  }

  // Amenity flags are only written when true, matching how the catalog reads
  // them: an absent key means unknown, not false.
  const amenities: ListingAmenities = {};
  if (bedrooms !== undefined) amenities.bedrooms = bedrooms;
  if (beds !== undefined) amenities.beds = beds;
  if (values.wifi) amenities.wifi = true;
  if (values.kitchen) amenities.kitchen = true;
  if (values.fireplace) amenities.fireplace = true;
  if (values.courtyard) amenities.courtyard = true;

  return {
    ok: true,
    input: {
      title,
      description,
      type: values.type,
      addressLine,
      city,
      region,
      country,
      timezone,
      nightlyRateCents,
      depositCents,
      maxGuests,
      amenities,
      instantBook: values.instantBook,
      cancellationPolicy: values.cancellationPolicy,
    },
  };
}

function sameAmenities(a: ListingAmenities | undefined, b: ListingAmenities | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key as keyof ListingAmenities] !== right[key as keyof ListingAmenities]) return false;
  }
  return true;
}

/**
 * The fields that actually changed.
 *
 * `PATCH /api/listings/:id` writes only the keys it is given, so sending the
 * diff means an untouched field is left exactly as the server has it.
 */
export function diffListingInput(original: ListingInput, next: ListingInput): Partial<ListingInput> {
  const patch: Partial<ListingInput> = {};
  const keys = [
    "title",
    "description",
    "type",
    "addressLine",
    "city",
    "region",
    "country",
    "timezone",
    "nightlyRateCents",
    "depositCents",
    "maxGuests",
    "instantBook",
    "cancellationPolicy",
  ] as const;

  for (const key of keys) {
    if (original[key] !== next[key]) {
      // Each branch is the same assignment; the cast keeps the union honest
      // without widening the patch type.
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  if (!sameAmenities(original.amenities, next.amenities)) patch.amenities = next.amenities;
  return patch;
}

/** Field order for the error summary, so the list reads top-to-bottom. */
export const LISTING_FIELD_ORDER: ListingFormField[] = [
  "title",
  "description",
  "type",
  "addressLine",
  "city",
  "region",
  "country",
  "timezone",
  "nightlyRate",
  "deposit",
  "maxGuests",
  "bedrooms",
  "beds",
  "cancellationPolicy",
  "instantBook",
];

/**
 * A blank form for a home that does not exist yet.
 *
 * Nothing here is invented to satisfy validation: the rate, deposit and name
 * start empty and the host has to supply them. The one suggested value is the
 * time zone, taken from the browser and shown for confirmation, because the
 * home's clock is a fact about the home and the browser only knows about the
 * person filling in the form.
 */
export function emptyListingForm(suggestedTimeZone: string): ListingFormValues {
  return {
    title: "",
    description: "",
    type: "entire_home",
    addressLine: "",
    city: "",
    region: "",
    country: "US",
    timezone: isValidTimeZone(suggestedTimeZone) ? suggestedTimeZone : "UTC",
    nightlyRate: "",
    deposit: "",
    maxGuests: "2",
    bedrooms: "",
    beds: "",
    wifi: false,
    kitchen: false,
    fireplace: false,
    courtyard: false,
    instantBook: false,
    cancellationPolicy: "moderate",
  };
}

/** The browser's own zone, as a starting suggestion only. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The wizard's groups.
 *
 * `POST /api/listings` is not a partial-draft endpoint — it requires a
 * complete, valid listing. So the wizard collects the fields the server needs
 * across the first and third groups and creates the draft once, at the end of
 * "Price and terms". The optional group in between can be skipped outright.
 */
export const LISTING_STEP_FIELDS = {
  basics: ["title", "type", "city", "region", "country", "timezone", "maxGuests"],
  details: ["description", "addressLine", "bedrooms", "beds"],
  price: ["nightlyRate", "deposit", "cancellationPolicy"],
} as const satisfies Record<string, readonly ListingFormField[]>;

export type ListingStepName = keyof typeof LISTING_STEP_FIELDS;

/**
 * Validate one group. The whole form is checked, then narrowed to the fields
 * on screen — a host is not shown an error about a field two steps ahead.
 */
export function errorsForStep(values: ListingFormValues, step: ListingStepName): ListingFormErrors {
  const result = listingFormToInput(values);
  if (result.ok) return {};
  const fields = LISTING_STEP_FIELDS[step] as readonly ListingFormField[];
  const narrowed: ListingFormErrors = {};
  for (const field of fields) {
    if (result.errors[field]) narrowed[field] = result.errors[field];
  }
  return narrowed;
}
