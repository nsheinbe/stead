# HM-D11 — Book path (HM-08 + existing kill-switch)

**Ticket:** HM-08 · **Route:** `/book/:listingId` (`BookPage`) and the
action card on `/listing/:id` · **Surface today:** `BookingsClosed`
panel, `guestBookingsOpen`, `POST /api/bookings` guard.
**Status:** specified.

## 1. Purpose and primary action

Keep the platform kill-switch exactly as it is, and add a second,
independent refusal for a home without a verified scan. Primary action
is unchanged: **Choose dates** → **Review price** → **Continue to
payment**, all only when the platform switch is on.

## 2. Who

Unchanged: anyone may read the home and the quote; a signed-in member
may create a booking when both gates are open.

## 3. Layout

**While `guestBookingsOpen` is false (Soft Dist today).** No change at
all. `/listing/:id` shows the `BookingsClosed` panel
(`data-testid="bookings-closed"`) in the action card; `/book/:listingId`
shows the `BOOKINGS_CLOSED_COPY` title as the `h1`, the panel and **Back
to the home**. No Payment Element, no calendar.

**When the switch is on and the listing is verified.** Unchanged
three-step flow.

**When the switch is on and the listing is not verified** (defensive
under D12/D13 — an `active` listing should always be verified). On
`/listing/:id`, the action card shows, in place of **Choose dates**, a
`StatusMessage tone="info" live={false}` titled "Not open for booking
yet" with the body "This home's honesty scan hasn't been verified. You
can still read the home and message the host." On `/book/:listingId`,
the same panel and **Back to the home**, no calendar. The create-booking
route refuses with the locked 409 regardless.

## 4. States

| Platform switch | Scan verified | Detail action card | `/book` | `POST /api/bookings` |
|---|---|---|---|---|
| off | any | `BookingsClosed` (unchanged) | closed page (unchanged) | 403 "Bookings aren't open yet." (unchanged) |
| on | yes | **Choose dates** | three steps | as today |
| on | no | "Not open for booking yet" panel (§3) | panel + back | 409 "This home isn't open for booking yet. Its honesty scan hasn't been verified." |
| on | owner viewing own home | **Edit your home** (unchanged) | n/a | n/a |

The quote endpoint stays readable in every row: a guest may price dates
on a home that is not yet bookable, and the quote reserves nothing.

## 5. Copy

- Unchanged and locked: `BOOKINGS_CLOSED_COPY.title` "Not open for
  bookings yet", body "Guest stays aren't live yet. You can still read
  the home and message the host."; `GUEST_BOOKINGS_CLOSED_MESSAGE`
  "Bookings aren't open yet."
- New, deliberately different words: title "Not open for booking yet"
  (singular, this home), body as §3; server 409 as
  [journeys §1.8](../JOURNEYS-AND-COPY.md#18-refusals-and-errors).

The difference between "bookings" (platform) and "booking" (this home)
is intentional and is asserted in tests; do not "harmonise" them.

## 6. What the server must have decided already

- `allowGuestBookings()` is exact-`1` only; unchanged.
- `getBookableListing` (or the guard beside `allowGuestBookings`)
  additionally requires `scan_verified_at IS NOT NULL` and returns the
  409 when absent — checked **after** the platform guard so the
  platform message wins while the switch is off.
- `PublicConfig.guestBookingsOpen` unchanged; the per-listing fact
  travels on `ListingDetail.honesty`.

## 7. Accessibility

Unchanged: static panels are `live={false}`; the `h1` on `/book` is the
panel title when closed.

## 8. Hard stops

- Do not change the kill-switch to accept `"true"` / `"yes"` / `"on"`.
- Do not set `ALLOW_GUEST_BOOKINGS=1` in Production, CI defaults that
  leak into deploy docs, or `.env.example` as a recommendation.
- Do not add a Book / Reserve control that pretends Dist is live.
- Do not reuse the kill-switch strings for the scan refusal.

## 9. Tests

- `tests/guest-bookings.test.ts`: unchanged and green.
- New: with `ALLOW_GUEST_BOOKINGS=1` in the test process, create-booking
  on a listing without `scan_verified_at` is 409 with the scan message
  and never touches Stripe; with `scan_verified_at` it proceeds to the
  mock path.
- Playwright: `Book / Reserve is closed when guest bookings are off`
  unchanged; a new case with the flag on and an unverified listing shows
  the per-home panel.

Copyright 2026 Stead contributors.
