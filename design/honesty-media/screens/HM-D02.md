# HM-D02 — Listing coordinates (HM-01)

**Ticket:** HM-01 · **Route:** `/host/listings/:listingId` (editor,
"Where it is" section, anchor `#where`) · **Surface today:**
`HostListingEditPage` "Where it is" card with street address, city,
region, country, time zone. **Status:** specified.

## 1. Purpose and primary action

Give the home a confirmed point the scan can be checked against, in the
host's words: "this is the front door". Primary action: **Confirm the
home's location**.

## 2. Who

Owner only (the editor already enforces this). Guests never see this
section; public reads of coordinates are out of the MVP (D08, D09).

## 3. Layout

Inside the existing "Where it is" `Card`, after the time zone field:

**Desktop.** A sub-section `h3` "Front door location" with a two-column
grid: Latitude, Longitude (`TextInput`, `inputMode="decimal"`, hint
"Decimal degrees, such as 45.5231"). Under the grid a row with **Use my
location here** (secondary) and a status line. Below, a `Checkbox`
"This is the front door of the home" and the primary **Confirm the
home's location** button, which is the only thing that sets
`coordinates_confirmed_at`.

**Phone.** Same controls stacked. **Use my location here** is first,
because a host on their phone at the door is the expected path; typed
coordinates are second.

There is no map in this ticket (D08). When HM-06 adds MapLibre with a
verified tile source, this section gains a drag-pin picker above the
fields; nothing else changes.

## 4. States

| State | Behaviour |
|---|---|
| Never set | Fields empty; status line "Not set. Guests can't book a home without a confirmed location and a verified scan." |
| Set, unconfirmed | Fields show values; `StatusPill tone="warning"` "Needs confirmation"; hint under the checkbox "Confirming records that you checked this point." |
| Confirmed | `StatusPill tone="brand"` "Confirmed {date}"; fields still editable; editing either field clears the pill and shows "Changing the location will need a new confirmation — and a new scan if one is verified." |
| Using device location | Button busy "Finding your phone…"; on a fix with accuracy within `scan_accuracy_max_m`: fields filled, status "From your phone, about {m} m accuracy"; rougher than the gate: fields **not** filled, status "Location: rough (about {m} m). Step outside for a better fix, or type the coordinates." |
| Permission denied | Status "Location: off. Allow location for this site, or type the coordinates." |
| Validation | Latitude outside −90…90 or longitude outside −180…180: field error "Not a valid latitude / longitude." Checkbox unchecked on confirm: "Tick the box to confirm this is the front door." via `ErrorSummary` |
| Saving | Reuses the editor's diff-save; **Confirm the home's location** sends `{ lat, lng, confirmCoordinates: true }` in one `PATCH` |
| Save failed | The editor's existing "We couldn't save your changes." with **Try again** |

## 5. Copy

- `h3`: "Front door location"
- Intro: "Your scan is checked against this point. Pick the front door,
  not the middle of the block."
- Checkbox: "This is the front door of the home"
- Primary: **Confirm the home's location**
- Secondary: **Use my location here**
- Privacy line: "Only you see these coordinates. Guests see the city and
  region, as they do today."

## 6. What the server must have decided already

- `PATCH /api/listings/:id` already validates ranges and persists
  `lat` / `lng` (R01). HM-01 adds `confirmCoordinates: boolean` which
  sets `coordinates_confirmed_at = now()` only when both values are
  present in the row after the patch, and a trigger (or the same
  `SECURITY DEFINER` path) clears `coordinates_confirmed_at` whenever
  `lat` or `lng` change.
- Changing confirmed coordinates on a listing with a verified scan does
  **not** un-verify the scan by itself (the scan was judged against the
  old point) but the next publish / status change goes through the
  gate; HM-08 decides whether to demote. Record: demote to `paused` when
  the confirmed point moves more than `scan_geofence_radius_m` from the
  point the verified scan was judged against.
- No IP geolocation, ever, as a value here.

## 7. Accessibility

- Fields have visible labels; hint text is associated via the shared
  `TextInput`.
- The status line is `role="status"` (polite).
- The checkbox is a real checkbox with a label, not a styled div.
- `ErrorSummary` links to the first invalid field.

## 8. Hard stops

- No silent IP geolocation as the coordinate.
- No auto-confirm: a value from the phone still needs the checkbox and
  the button.
- No public exposure of raw coordinates in this ticket.

## 9. Tests

- As built in HM-01: the front door is its own small form beside the
  listing diff (`src/lib/coordinates.ts`, `tests/coordinates.test.ts`), so
  "Save changes" can never confirm a point by accident and the listing
  diff never carries `lat` / `lng`.
- HTTP: `confirmCoordinates` without both values is a 400; a change to
  `lat` clears `coordinates_confirmed_at`.
- Playwright: confirm with typed values; the pill; editing clears it.

Copyright 2026 Stead contributors.
