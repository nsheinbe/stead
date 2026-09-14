/**
 * Which Explore results surface to show.
 *
 * Filter-empty ("no homes match") is only honest when the unfiltered catalog
 * has homes. On a live marketplace with zero listings — Soft Dist — leftover
 * query params from landing search must not hide the host-led first-user path.
 */
export type ExploreResultsView = "loading" | "error" | "catalog_empty" | "filters_empty" | "results";

export function exploreResultsView(input: {
  listingsPending: boolean;
  listingsError: boolean;
  resultCount: number | undefined;
  catalogPending: boolean;
  catalogCount: number | undefined;
  hasFilters: boolean;
}): ExploreResultsView {
  if (input.listingsPending) return "loading";
  if (input.listingsError) return "error";
  if ((input.resultCount ?? 0) > 0) return "results";
  // Wait for the unfiltered catalog so we don't call an empty marketplace
  // "no homes match these filters".
  if (input.catalogPending) return "loading";
  if ((input.catalogCount ?? 0) === 0) return "catalog_empty";
  if (input.hasFilters) return "filters_empty";
  return "catalog_empty";
}
