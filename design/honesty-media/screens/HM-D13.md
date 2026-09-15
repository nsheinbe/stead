# HM-D13 — Host homes list (HM-09; scan row from HM-01 onward)

**Ticket:** HM-09 (final), each earlier ticket adds its own state ·
**Route:** `/host/listings` (`HostListingsPage`) · **Surface today:** one
`Card` per home with status pill, note, **Edit this home**, **Publish
this home** / **Take it off the market**, **Delete**. **Status:**
specified.

## 1. Purpose and primary action

Show each home's scan state as a fact of its own and offer exactly one
next action for it. Primary action per row is unchanged (**Edit this
home**); the scan action is the second button.

## 2. Who

Owner only (existing).

## 3. Layout

Inside each existing row `Card`, under the status note
(`STATUS_NOTE[listing.status]`), a new line:

**Desktop.** `StatusPill` (owner honesty treatment,
[HM-D12](HM-D12.md)) followed by the state label's one next action as a
`ButtonLink size="sm" variant="secondary"` (from
[journeys §1.6](../JOURNEYS-AND-COPY.md#16-host-scan-states)). It sits
on the same line as the pill when there is room.

**Phone.** Pill on one line, the action button full-width beneath it,
before the existing action row.

The existing **Publish this home** button on a draft / paused row is
replaced by the scan's next action while the scan is not verified
(publishing would be refused anyway, and the checklist explains it on
the editor). When the scan is verified the existing button returns.

The page-level payouts banner is unchanged. A page-level honesty banner
is **not** added: the per-row pill is enough, and two banners would
compete.

## 4. States

| `HostListing.scan` | Pill | Next action |
|---|---|---|
| `null`, coordinates unconfirmed | "Needs the home's location" (warning) | **Confirm the home's location** → editor `#where` |
| `null`, coordinates confirmed | "Not started" (neutral) | **Scan this home** |
| `capturing` (no parts) | "Capturing" | **Continue the walk** |
| `capturing` (parts) | "Uploading" | **Finish uploading** |
| `uploaded` / `reconstructing` | "Queued for processing" / "Processing" | **Check progress** |
| `needs_mask` | "Needs private rooms marked" (warning) | **Mark private rooms** |
| `verified` | "Verified {date}" (brand) | **View the walkthrough** |
| `rejected` | "Couldn't confirm the location" (warning) | **Walk again** |
| `failed` | "Processing didn't finish" (warning) | **See what happened** |
| Hidden seed row (owner) | "No honesty scan yet" | **Scan this home** (it will be refused for a seed row by the server with "Demo homes can't be scanned."; the button exists so the owner learns why) |
| Loading | Row renders as today; the scan line shows a `SkeletonText` |
| Scan fetch failed | Line "We couldn't check the scan." with **Try again**; the rest of the row works |

The empty state ("You haven't added a home yet.") is unchanged.

## 5. Copy

Labels and actions are the locked table. The seed refusal is a new
locked string: "Demo homes can't be scanned."

## 6. What the server must have decided already

- `HostListing.scan` is computed server-side from `listing_scans`,
  `coordinates_confirmed_at`, and uploaded parts; the row never derives
  a state from timestamps.
- Every row belongs to the session's member (RLS on `listings` and
  `listing_scans`).
- `POST …/scan` refuses hidden seed ids with the message above.

## 7. Accessibility

- The pill text is the status; the action button is named by its
  label plus the home ("Scan this home" is unambiguous within the card,
  which is a labelled region by its `h2`).
- The scan line does not change the card's heading or the primary
  action order.

## 8. Hard stops

- Never show another host's scan state (RLS + owner DTO).
- Never show a seed home as verified.
- Never let the row's **Publish this home** bypass the gate; the server
  refuses regardless of the button.

## 9. Tests

- Vitest: state → pill / action mapping is total.
- HTTP: `/api/listings/mine` includes `scan` for the owner only;
  `tests/listing-edit.test.ts` still asserts the summary is not an
  editor hydration source.
- Playwright: `the homes dashboard sends creation to the wizard and
  confirms deletion` unchanged; a new case asserts the next action per
  stubbed state.

Copyright 2026 Stead contributors.
