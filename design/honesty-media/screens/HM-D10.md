# HM-D10 — Publish checklist (HM-08)

**Ticket:** HM-08 · **Route:** `/host/listings/:listingId` (`?setup=
review` step and the editor header) · **Surface today:** `ReviewStep` in
`HostListingEditPage`. **Status:** specified.

## 1. Purpose and primary action

Make publishing an informed action and make the scan requirement
impossible to miss. Primary action: **Publish this home**, enabled only
when the server would accept it.

## 2. Who

Owner only (existing).

## 3. Layout

Inside `ReviewStep`, between the details `Card` and the "Payouts are
separate from publishing" `Surface`, a new `Card` "Before you publish"
(`h3`) containing a `DataList`-style checklist. Each row: a label, a
status, and at most one link. Rows in order:

| Row | Status text | Link |
|---|---|---|
| Photos | "{n} photos" or "None yet — a home with no photos is a hard sell." (warning, not blocking, unchanged rule) | **Add photos** (`?setup=photos`) |
| Description | "Written" or "None yet." (warning, not blocking) | **Edit these details** |
| Front door location | "Confirmed {date}" or "Not confirmed. Needed for the scan." | **Confirm the home's location** (`#where`) |
| Honesty scan | From [journeys §1.6](../JOURNEYS-AND-COPY.md#16-host-scan-states): "Verified {date}" or the state label + "Guests can't book without it." | The state's one next action |
| Payouts | Existing surface stays as is below the card; the row here just says "Set up separately — see below." | none |

Under the checklist, the existing buttons. **Publish this home** is
disabled while the honesty scan row is not "Verified", with the adjacent
reason text (§5). **Keep it a draft** stays.

The editor header (outside setup) gets nothing new except that the
status pill area shows the owner-only honesty pill
([HM-D12](HM-D12.md)) next to the listing status pill.

## 4. States

| State | Behaviour |
|---|---|
| Scan verified, draft | **Publish this home** enabled; row "Verified {date}" with **View the walkthrough** |
| Scan not verified, draft | Button disabled; reason text; row shows the next action |
| Already `active` | Existing success message, **revised** copy (§5); no checklist changes |
| Publish refused by server (stale page) | Existing "We couldn't publish this home." with the server's locked 409 message in the body and the checklist refetched |
| Loading scan | Row shows a `SkeletonText` line; button disabled until known |
| Scan fetch failed | Row "We couldn't check the scan." with **Try again**; button disabled |

## 5. Copy

- Card `h3`: "Before you publish"
- Reason under the disabled button: "Publishing needs a verified
  honesty scan. Guests can't book a home without one."
- Revised success message (replaces "Guests can find it and request
  stays of 30 nights or more."): "Your home is published. Guests can
  find it and read the walkthrough. Booking opens when Stead turns on
  guest bookings — that's separate from your listing." (Stays of 30
  nights or more remain stated on the detail page.)
- Row labels and statuses as §3.

## 6. What the server must have decided already

- The publish call goes through `app.set_listing_status(listing_id,
  'active')` (D04), which refuses without `scan_verified_at` with the
  locked 409, and is the only path that can set `active` after the
  column grant is revoked.
- Scan state and `coordinates_confirmed_at` come from `GET …/scan` and
  `GET /api/listings/:id` (owner fields).
- Payout readiness is unchanged and stays a separate fact.

## 7. Accessibility

- The checklist is a real list / `DataList`; statuses are text.
- The disabled button has the reason as visible text immediately after
  it, not only a tooltip.
- The refused-publish message is a live alert (danger tone), as today.

## 8. Hard stops

- Never treat "Verified" as "bookable" in copy; bookings-on is Nick's
  switch.
- Never make payout readiness a publish blocker (existing rule) or make
  the scan imply payouts.
- Never remove the server refusal because the button is disabled.

## 9. Tests

- HTTP: `active` refused without `scan_verified_at`; allowed with;
  `tests/guest-bookings.test.ts` untouched.
- Playwright: cannot publish without a scan (button disabled with the
  reason); after a stubbed verified scan the button enables and the
  revised success copy appears. Extend `the wizard creates exactly one
  draft, then publishes it` to seed a verified scan in the harness
  rather than weakening the gate.

Copyright 2026 Stead contributors.
