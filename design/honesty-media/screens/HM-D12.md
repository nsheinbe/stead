# HM-D12 — Honesty badge (HM-09; may land with HM-05)

**Ticket:** HM-09 (badge), copy from HM-00 · **Routes:** `ListingCard`
(Explore, Landing), `/listing/:id`, `/listing/:id/walk`, owner surfaces
· **Surface today:** none. **Status:** specified.

## 1. Purpose and primary action

Say, in text, that a walkthrough is geo-proven, host-captured and
stitched-not-invented — and say nothing when it is not. No CTA of its
own; it sits next to the walk entry.

## 2. Who

Public surfaces show only the verified badge. The processing and
missing labels are owner-only (dashboard, editor header, status page).

## 3. Treatments

| Treatment | Where | Rendering |
|---|---|---|
| Compact | `ListingCard`, walk chrome under 650 px, nearby cards | `StatusPill tone="brand"` with a 12 px check glyph (`aria-hidden`) and `badge.short`. Placed after the place line, before the title, so it reads as a fact about the place |
| Full | `/listing/:id` walk section, walk chrome ≥ 650 px, disclosure dialog | One line of text in `text-sm font-semibold text-brand` on `bg-surface-accent` with the check glyph: `badge.full`. Below it, in `text-ink-secondary`: "Captured {date}" · coverage line. **About this walkthrough** as a `<details>` or `Dialog` trigger |
| Owner: processing | `/host/listings` row, editor header, status page | `StatusPill tone="neutral"` "Honesty scan in progress" (or the exact state label from journeys §1.6 where the row has room) |
| Owner: missing | same | `StatusPill tone="warning"` "No honesty scan yet" |

Colour per D01: brand ink on accent surface. If Nick chooses a distinct
verification hue, it is added as a semantic token and swapped here in
one place (`src/components/HonestyBadge.tsx`).

## 4. States

| Listing | Public card / detail | Owner surfaces |
|---|---|---|
| Verified, active | Compact / full badge | "Verified {date}" |
| Verified, draft or paused | Nothing public (listing not visible) | "Verified {date}" |
| Processing | Nothing public | "Honesty scan in progress" / state label |
| Rejected / failed | Nothing public | State label with next action |
| Never scanned | Nothing public | "No honesty scan yet" |
| Hidden seed row | Nothing public; owner view "No honesty scan yet" | same |

There is no public "unverified" badge. Absence is the honest state and
avoids shaming a draft that is still being set up.

## 5. Copy

Locked strings only: `badge.short`, `badge.full`, `badge.ownerProcessing`,
`badge.ownerMissing`, `capturedOn`, `capturedOn.hint`, `coverage.*`.

## 6. What the server must have decided already

- `honesty` on the public DTOs is present only for verified, active
  listings (server-derived; the card never computes it from other
  fields).
- Owner surfaces read `HostListing.scan` / `GET …/scan`.

## 7. Accessibility

- The badge is text; the glyph is `aria-hidden`.
- On cards, the badge sits inside the single card link and reads in
  order: place, badge, title — no nested interactive element.
- Contrast: brand `#1E4034` on accent surface `#E9F1EC` exceeds AA for
  small text (measured contrast is still a manual QA item).

## 8. Hard stops

- The badge is not the Trust Passport and never appears in
  `TrustPassportCard` or `/passport/:userId`.
- No shield, seal, ribbon, stamp, hologram, serial number, or "verified
  by GPS".
- Never shown for a seed row, a draft, or a scan that is not `verified`.
- Brass `#B58B3E` is not used (D01); if reopened, it is a design-system
  change, not a badge change.

## 9. Tests

- Vitest: `HonestyBadge` renders nothing for `honesty: null`; renders
  the locked strings for verified; owner variants only when asked.
- Playwright: Explore card shows the compact badge for a stubbed
  verified listing and nothing for another; detail shows the full
  treatment and the disclosure.

Copyright 2026 Stead contributors.
