import { describe, expect, it } from "vitest";
import { listingFiltersToSearch, parseListingFilters } from "../src/lib/filters";

describe("listing filter query string", () => {
  it("reads city, type, guests, max rate, and instant book", () => {
    const filters = parseListingFilters(
      new URLSearchParams("city=Hudson&type=entire_home&guests=3&maxRate=20000&instant=1&q=cottage"),
    );
    expect(filters).toEqual({
      q: "cottage",
      city: "Hudson",
      type: "entire_home",
      guests: 3,
      maxNightlyRateCents: 20_000,
      instantBook: true,
    });
  });

  it("drops unknown types, non-integer money, and empty strings", () => {
    const filters = parseListingFilters({
      type: "castle",
      guests: "two",
      maxRate: "19.99",
      city: "  ",
      instant: "no",
    });
    expect(filters).toEqual({
      q: undefined,
      city: undefined,
      type: undefined,
      guests: undefined,
      maxNightlyRateCents: undefined,
      instantBook: undefined,
    });
  });

  it("round-trips through the search string", () => {
    const qs = listingFiltersToSearch({
      city: "Lisbon",
      type: "apartment",
      instantBook: true,
    });
    expect(qs).toBe("city=Lisbon&type=apartment&instant=1");
    expect(parseListingFilters(new URLSearchParams(qs))).toMatchObject({
      city: "Lisbon",
      type: "apartment",
      instantBook: true,
    });
  });
});
