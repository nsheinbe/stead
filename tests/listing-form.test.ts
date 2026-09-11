/**
 * HOST-01. The editor's data contract.
 *
 * The defect this guards against (F07) is silent: hydrate from a summary that
 * omits a field, rebuild an input from it, and the omitted field is saved as an
 * empty default. So the central assertion is a round trip — detail in, input
 * out, nothing lost — plus the rule that an untouched field never appears in
 * the PATCH body at all.
 */
import { describe, expect, it } from "vitest";
import {
  centsToDollarsInput,
  diffListingInput,
  emptyListingForm,
  errorsForStep,
  isValidTimeZone,
  listingFormFromDetail,
  listingFormToInput,
  type ListingFormValues,
} from "../src/lib/listingForm";
import type { ListingDetail, ListingInput } from "../src/lib/types";

/** A listing with every editable field carrying a distinctive value. */
function fullListing(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "The Gatehouse",
    description: "A stone gatehouse at the end of a long drive.\n\nQuiet.",
    type: "entire_home",
    addressLine: "14 Mill Lane",
    city: "Hudson",
    region: "New York",
    country: "US",
    timezone: "America/New_York",
    nightlyRateCents: 19_950,
    depositCents: 30_000,
    maxGuests: 4,
    amenities: { bedrooms: 2, beds: 3, wifi: true, kitchen: true },
    instantBook: true,
    cancellationPolicy: "strict",
    photos: [{ id: "p1", storagePath: "https://example.test/a.jpg", sortOrder: 0 }],
    status: "draft",
    host: { id: "22222222-2222-2222-2222-222222222222", displayName: "Ada", avatarUrl: null },
    ...overrides,
  };
}

function unwrap(values: ListingFormValues): ListingInput {
  const result = listingFormToInput(values);
  if (!result.ok) throw new Error(`expected valid form, got ${JSON.stringify(result.errors)}`);
  return result.input;
}

describe("hydrating the editor from listing detail", () => {
  it("round-trips every editable field without loss", () => {
    const listing = fullListing();
    const input = unwrap(listingFormFromDetail(listing));

    expect(input).toEqual({
      title: listing.title,
      description: listing.description,
      type: listing.type,
      addressLine: listing.addressLine,
      city: listing.city,
      region: listing.region,
      country: listing.country,
      timezone: listing.timezone,
      nightlyRateCents: listing.nightlyRateCents,
      depositCents: listing.depositCents,
      maxGuests: listing.maxGuests,
      amenities: listing.amenities,
      instantBook: listing.instantBook,
      cancellationPolicy: listing.cancellationPolicy,
    });
  });

  it("produces an empty patch when nothing was touched", () => {
    const listing = fullListing();
    const original = unwrap(listingFormFromDetail(listing));
    const untouched = unwrap(listingFormFromDetail(listing));
    expect(diffListingInput(original, untouched)).toEqual({});
  });

  it("sends only the field that changed", () => {
    const listing = fullListing();
    const values = listingFormFromDetail(listing);
    const original = unwrap(values);
    const next = unwrap({ ...values, nightlyRate: "225" });

    const patch = diffListingInput(original, next);
    expect(patch).toEqual({ nightlyRateCents: 22_500 });
    // The description the editor loaded is not resent, so it cannot be
    // clobbered by a stale read.
    expect(patch).not.toHaveProperty("description");
    expect(patch).not.toHaveProperty("amenities");
  });

  it("notices an amenity change in either direction", () => {
    const listing = fullListing();
    const values = listingFormFromDetail(listing);
    const original = unwrap(values);

    expect(diffListingInput(original, unwrap({ ...values, fireplace: true }))).toEqual({
      amenities: { bedrooms: 2, beds: 3, wifi: true, kitchen: true, fireplace: true },
    });
    expect(diffListingInput(original, unwrap({ ...values, wifi: false }))).toEqual({
      amenities: { bedrooms: 2, beds: 3, kitchen: true },
    });
  });

  it("keeps an absent amenity absent rather than writing it false", () => {
    // The catalog reads a missing key as unknown, not as "this home has no
    // fireplace", and the detail page renders it that way.
    const listing = fullListing({ amenities: { bedrooms: 1 } });
    const input = unwrap(listingFormFromDetail(listing));
    expect(input.amenities).toEqual({ bedrooms: 1 });
    expect(input.amenities).not.toHaveProperty("wifi");
    expect(input.amenities).not.toHaveProperty("fireplace");
  });

  it("round-trips a listing whose optional fields are empty", () => {
    const listing = fullListing({
      description: "",
      addressLine: "",
      region: "",
      amenities: {},
      instantBook: false,
    });
    const input = unwrap(listingFormFromDetail(listing));
    expect(input.description).toBe("");
    expect(input.addressLine).toBe("");
    expect(input.region).toBe("");
    expect(input.amenities).toEqual({});
    expect(input.instantBook).toBe(false);
  });
});

describe("money in the editor", () => {
  it("formats cents for a text input without floating point", () => {
    expect(centsToDollarsInput(20_000)).toBe("200");
    expect(centsToDollarsInput(19_950)).toBe("199.50");
    expect(centsToDollarsInput(1)).toBe("0.01");
    expect(centsToDollarsInput(0)).toBe("0");
  });

  it("parses dollars back to the exact cents", () => {
    const base = listingFormFromDetail(fullListing());
    // 8.07 * 100 is 806.9999999999999 in binary floating point; the old editor
    // multiplied and rounded, this one parses the string.
    expect(unwrap({ ...base, nightlyRate: "8.07" }).nightlyRateCents).toBe(807);
    expect(unwrap({ ...base, nightlyRate: "1.10" }).nightlyRateCents).toBe(110);
    expect(unwrap({ ...base, deposit: "0" }).depositCents).toBe(0);
  });

  it("rejects money it cannot parse exactly", () => {
    const base = listingFormFromDetail(fullListing());
    for (const bad of ["", "abc", "-5", "1.005", "1e3", "200 ", "$200"]) {
      const result = listingFormToInput({ ...base, nightlyRate: bad });
      // A trailing space is fine; everything else is a refusal.
      if (bad === "200 ") {
        expect(result.ok).toBe(true);
        continue;
      }
      expect(result.ok, `expected "${bad}" to be refused`).toBe(false);
    }
  });

  it("refuses a free stay, because the server does", () => {
    const base = listingFormFromDetail(fullListing());
    const result = listingFormToInput({ ...base, nightlyRate: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.nightlyRate).toMatch(/at least \$0\.01/);
  });
});

describe("validation mirrors the server's bounds", () => {
  const base = listingFormFromDetail(fullListing());

  it("requires a usable name and city", () => {
    const short = listingFormToInput({ ...base, title: "ab" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.title).toBeTruthy();

    const noCity = listingFormToInput({ ...base, city: "   " });
    expect(noCity.ok).toBe(false);
    if (!noCity.ok) expect(noCity.errors.city).toBeTruthy();
  });

  it("insists on a two-letter country code and normalises its case", () => {
    expect(listingFormToInput({ ...base, country: "USA" }).ok).toBe(false);
    expect(listingFormToInput({ ...base, country: "U" }).ok).toBe(false);
    expect(unwrap({ ...base, country: "gb" }).country).toBe("GB");
  });

  it("refuses a time zone Postgres would later choke on", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);

    const result = listingFormToInput({ ...base, timezone: "Mars/Olympus" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.timezone).toMatch(/IANA/);
  });

  it("bounds the party size", () => {
    expect(listingFormToInput({ ...base, maxGuests: "0" }).ok).toBe(false);
    expect(listingFormToInput({ ...base, maxGuests: "51" }).ok).toBe(false);
    expect(listingFormToInput({ ...base, maxGuests: "2.5" }).ok).toBe(false);
    expect(unwrap({ ...base, maxGuests: "50" }).maxGuests).toBe(50);
  });

  it("reports every bad field at once, not just the first", () => {
    const result = listingFormToInput({ ...base, title: "a", city: "", country: "XYZ" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["city", "country", "title"]);
    }
  });
});

describe("the creation wizard's groups (HOST-02)", () => {
  it("invents nothing a host has to decide", () => {
    const blank = emptyListingForm("America/New_York");
    // No made-up name, and no default price standing in for one the host has
    // not chosen. `POST /api/listings` will refuse this, which is correct.
    expect(blank.title).toBe("");
    expect(blank.nightlyRate).toBe("");
    expect(blank.deposit).toBe("");
    expect(listingFormToInput(blank).ok).toBe(false);
  });

  it("suggests the browser's zone but only when it is a real one", () => {
    expect(emptyListingForm("Europe/London").timezone).toBe("Europe/London");
    expect(emptyListingForm("Mars/Olympus").timezone).toBe("UTC");
    expect(emptyListingForm("").timezone).toBe("UTC");
  });

  it("shows a host only the errors for the group they are on", () => {
    const blank = emptyListingForm("UTC");

    // Basics is incomplete and the price is empty, but only Basics is on screen.
    const basics = errorsForStep(blank, "basics");
    expect(Object.keys(basics)).toEqual(["title", "city"]);
    expect(basics).not.toHaveProperty("nightlyRate");

    // The optional group never blocks anyone.
    expect(errorsForStep(blank, "details")).toEqual({});

    // Price does not complain about the name the host already fixed upstream.
    const price = errorsForStep(blank, "price");
    expect(Object.keys(price).sort()).toEqual(["deposit", "nightlyRate"]);
    expect(price).not.toHaveProperty("title");
  });

  it("passes a group once its own fields are good", () => {
    const values: ListingFormValues = {
      ...emptyListingForm("UTC"),
      title: "The Gatehouse",
      city: "Hudson",
    };
    expect(errorsForStep(values, "basics")).toEqual({});
    // The listing as a whole is still incomplete — the price group has yet to
    // be filled in, which is exactly why the draft is not created until then.
    expect(listingFormToInput(values).ok).toBe(false);
  });

  it("is complete once every group has been filled in", () => {
    const values: ListingFormValues = {
      ...emptyListingForm("UTC"),
      title: "The Gatehouse",
      city: "Hudson",
      nightlyRate: "200",
      deposit: "300",
    };
    expect(errorsForStep(values, "price")).toEqual({});
    const result = listingFormToInput(values);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.nightlyRateCents).toBe(20_000);
      expect(result.input.depositCents).toBe(30_000);
    }
  });
});
