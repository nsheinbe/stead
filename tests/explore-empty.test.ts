import { describe, expect, it } from "vitest";
import { exploreResultsView } from "../src/lib/exploreEmpty";

describe("exploreResultsView", () => {
  const loaded = {
    listingsPending: false,
    listingsError: false,
    catalogPending: false,
  };

  it("shows skeletons while listings load", () => {
    expect(
      exploreResultsView({
        ...loaded,
        listingsPending: true,
        resultCount: undefined,
        catalogCount: undefined,
        hasFilters: false,
      }),
    ).toBe("loading");
  });

  it("shows the host-led empty state when the catalog has no homes", () => {
    expect(
      exploreResultsView({
        ...loaded,
        resultCount: 0,
        catalogCount: 0,
        hasFilters: false,
      }),
    ).toBe("catalog_empty");
  });

  it("keeps the host-led empty state when leftover search params hit an empty catalog", () => {
    expect(
      exploreResultsView({
        ...loaded,
        resultCount: 0,
        catalogCount: 0,
        hasFilters: true,
      }),
    ).toBe("catalog_empty");
  });

  it("waits for the unfiltered catalog before calling leftover params a filter miss", () => {
    expect(
      exploreResultsView({
        ...loaded,
        catalogPending: true,
        resultCount: 0,
        catalogCount: undefined,
        hasFilters: true,
      }),
    ).toBe("loading");
  });

  it("shows filter-empty only when the catalog actually has homes", () => {
    expect(
      exploreResultsView({
        ...loaded,
        resultCount: 0,
        catalogCount: 4,
        hasFilters: true,
      }),
    ).toBe("filters_empty");
  });

  it("shows results when any listing matched", () => {
    expect(
      exploreResultsView({
        ...loaded,
        resultCount: 2,
        catalogCount: 6,
        hasFilters: true,
      }),
    ).toBe("results");
  });

  it("treats a catalog load failure with no results as catalog-empty, not a filter miss", () => {
    expect(
      exploreResultsView({
        listingsPending: false,
        listingsError: false,
        resultCount: 0,
        catalogPending: false,
        catalogCount: undefined,
        hasFilters: true,
      }),
    ).toBe("catalog_empty");
  });
});
