# HM-D09 — Neighbourhood walk (HM-07)

**Ticket:** HM-07 · **Route:** `/walk?city=…` (D19), entered from
`/explore` · **Surface today:** `ExplorePage` and `ExploreFilters`.
**Status:** specified; depends on D08 (tiles, imagery source) and D09.

## 1. Purpose and primary action

Let a guest look around a real city and find real Stead homes in it —
and only those. Primary action on a pin: **Walk through this home**.

## 2. Who

Public. No sign-in. Nothing here is member-scoped.

## 3. Layout

### Entry on Explore

In `ExploreFilters`, when `filters.city` is set **and** at least one
result on screen has `honesty` non-null, a `ButtonLink variant="quiet"`
**Walk {city}** → `/walk?city={city}` appears next to the result count.
Otherwise it is absent (not disabled). The direct URL always works.

### `/walk`

Wide shell, renter workspace, `h1` "Walk {city}" (or "Walk a
neighbourhood" without a city). Under the `h1`:

**Desktop (≥ 1024 px).** Two panes. Left (40 %): the MapLibre map with
the city's Stead pins and a list beneath it, "Homes on Stead near here"
(`h2`) with one compact card per pin (title, place, badge short form,
30-night estimate via the existing `estimateLabel`, **Walk through this
home**). Right (60 %): the street view for the selected pin — the host's
approach footage when the viewer is entitled ([HM-D08](HM-D08.md)),
otherwise the third-party imagery panel when the layer exists, otherwise
the imagery-none sentence over a neutral surface.

**Phone.** Street view first (4:3), then the "Homes on Stead near here"
list; the map opens in a `Dialog size="lg"` from a **Map** button and
returns focus on close. Selecting a card scrolls the street view into
view and announces the home.

The city control is the existing Explore city `Select` (same source of
cities: the unfiltered catalog), placed under the `h1`. Changing it
updates the URL (`?city=`) and reloads pins.

## 4. States

| State | Behaviour |
|---|---|
| Loading | Skeleton map block and three `ListingCardSkeleton`-style rows; sr-only "Loading homes near here" |
| Pins present | Map shows one pin per verified active listing in the bbox; list matches; the first pin is selected |
| Empty city | `EmptyState` with `nearby.empty` ("No homes on Stead in {city} yet.") and `CatalogEmptyActions` (**List your home**, **Start your listing**). Map still renders the city; no pins; no placeholder cottages |
| No city (`/walk` bare) | `h1` "Walk a neighbourhood", the city `Select` with "Choose a city", and the same empty copy without the city name |
| Unknown city value | Normalise like Explore does (case-insensitive match against the catalog cities); if no match, treat as empty with the typed value shown in the sentence |
| Tiles unavailable | Map replaced by the tiles-unavailable panel from [HM-D08](HM-D08.md); the list and street view still work |
| Imagery: host | Label `imagery.host` |
| Imagery: third-party | Label `imagery.thirdParty` with the provider; never at the door pose |
| Imagery: none | `imagery.none` sentence |
| Query error | `StatusMessage tone="danger"` "We couldn't load homes near here." with **Try again**; the map stays |
| Reduced motion | No fly-to animation on selection; the map jumps |

## 5. Copy

- `h1`: "Walk {city}" / "Walk a neighbourhood"
- `h2`: `nearby.heading`; explainer `nearby.explainer` under it
- Empty: `nearby.empty`
- Card action: **Walk through this home**
- Explore entry: **Walk {city}**
- Map button (phone): **Map**

## 6. What the server must have decided already

- `GET /api/walk/nearby?lat&lng&radiusM` (or `?city=` resolving to the
  catalog's city bbox) returns only listings that are `active`, have
  `scan_verified_at`, are not hidden seed ids, and only the public
  fields of `ListingSummary` plus a **server-rounded** pin (D09). The
  radius is capped server-side; the index is chosen in the migration
  (earthdistance or a `geography` column) and tested.
- Another host's draft, a paused home, a rejected scan: absent from the
  response, not filtered client-side.
- Third-party imagery, if any, is fetched by the client from the
  provider under that provider's terms; the server never proxies it and
  never stores it as a Stead artifact.

## 7. Accessibility

- The map has an accessible name and the pins are mirrored by the list,
  so nothing is map-only.
- Selecting a card announces "{title} selected" politely.
- The phone map `Dialog` traps focus and closes with Escape.
- The city `Select` is labelled "City".

## 8. Hard stops

- No generated street fabric, "typical block", or seed cottage.
- No pin that is not a real, verified, active `listings` row.
- Third-party imagery is context, never inventory, never a façade for
  a home the host did not film.
- No exact coordinates beyond what D09 allows.

## 9. Tests

- HTTP: nearby excludes draft / paused / rejected / seed; rounds pins;
  caps radius.
- RLS: the spatial read as an anonymous member returns only public rows.
- Playwright: empty city with host actions; Explore entry link appears
  only with a verified result; tiles-unavailable panel.

Copyright 2026 Stead contributors.
