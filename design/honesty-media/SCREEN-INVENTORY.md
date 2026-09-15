# Honesty media — screen inventory

**Status:** Every HM-D row is specified and ready for review. Nothing in
this folder is implemented; do not read a filled spec as a claim that a
screen exists on Production. Implementation follows
[`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md)
on a dedicated branch off `main`, one reviewable slice per PR.

**Companions:** [journeys and locked copy](JOURNEYS-AND-COPY.md) ·
[reconciliation and open decisions](DECISIONS.md) ·
[brief](DESIGN_BRIEF.md).

Existing Stead routes stay. Five new URLs are added, chosen so capture
and walk are bookmarkable and the 3D / map code stays out of every
other route's bundle. Each row below links to its full spec under
`screens/`; the canonical route in that file wins over any earlier
"proposed" path.

Copyright 2026 Stead contributors.

---

## Inventory

| ID | Ticket | Canonical route | Surface today | Spec | Depends on decisions |
|---|---|---|---|---|---|
| HM-D00 | HM-00 | (copy module, not a route) | — | [screens/HM-D00.md](screens/HM-D00.md) | D01, D02 |
| HM-D01 | HM-01 | `/host/listings/:listingId/scan` | none | [screens/HM-D01.md](screens/HM-D01.md) | D05, D07, D15 |
| HM-D02 | HM-01 | `/host/listings/:listingId#where` (editor section) | `HostListingEditPage` "Where it is" | [screens/HM-D02.md](screens/HM-D02.md) | D08 (deferred map) |
| HM-D03 | HM-02 | `/host/listings/:listingId/scan` (upload step) | none | [screens/HM-D03.md](screens/HM-D03.md) | D06, D16 |
| HM-D04 | HM-03 | `/host/listings/:listingId/scan/status` | built (HM-03): `src/pages/HostListingScanStatus.tsx` | [screens/HM-D04.md](screens/HM-D04.md) | D03, D14 |
| HM-D05 | HM-04 | `/host/listings/:listingId/scan/mask` | built (HM-04): `src/pages/HostListingScanMask.tsx` | [screens/HM-D05.md](screens/HM-D05.md) | D10, D11 |
| HM-D06 | HM-05 | `/listing/:id` (walk entry section) | `ListingDetailPage` | [screens/HM-D06-D07.md](screens/HM-D06-D07.md) | D20 |
| HM-D07 | HM-05 | `/listing/:id/walk` | none | [screens/HM-D06-D07.md](screens/HM-D06-D07.md) | D20 |
| HM-D08 | HM-06 | `/listing/:id` ("The street") + tether in `/listing/:id/walk` | none | [screens/HM-D08.md](screens/HM-D08.md) | D08, D09, D21 |
| HM-D09 | HM-07 | `/walk?city=` (entry from `/explore`) | `ExplorePage`, `ExploreFilters` | [screens/HM-D09.md](screens/HM-D09.md) | D08, D09, D19 |
| HM-D10 | HM-08 | `/host/listings/:listingId?setup=review` | `ReviewStep` | [screens/HM-D10.md](screens/HM-D10.md) | D04, D12, D13 |
| HM-D11 | HM-08 | `/book/:listingId` + action card on `/listing/:id` | `BookPage`, `BookingsClosed` | [screens/HM-D11.md](screens/HM-D11.md) | D12 |
| HM-D12 | HM-09 | cards / detail / walk / owner surfaces | `ListingCard`, detail | [screens/HM-D12.md](screens/HM-D12.md) | D01 |
| HM-D13 | HM-09 | `/host/listings` | `HostListingsPage` | [screens/HM-D13.md](screens/HM-D13.md) | — |

Existing routes **not** in this table stay as they are. The only edits
outside this table are the three one-line mentions HM-00 adds to
`/for-homeowners` and `/host/start` ([HM-D00 §5](screens/HM-D00.md)).
Payouts, claims, trips, messages, login and the Trust Passport are not
redesigned in this phase.

---

## What every screen inherits

Each `screens/HM-D*.md` follows the same nine sections: purpose and
primary action · who can open it · desktop and phone layout · states ·
copy · what the server must already have decided · accessibility · hard
stops · tests. On top of that, all of them inherit:

**Universal states** from the shipped redesign
(`redesign-handoff/design/02-SCREEN-SPECS.md` §2): skeleton plus a short
labelled loading status; refresh keeps valid content; empty explains and
offers the next action; validation keeps input and summarises; network
error is plain language plus Retry; unauthorised waits for the session
then shows the contextual sign-in with the exact return path; one
mutation at a time with a busy label; success comes from returned server
state and is announced once. Honesty screens add stricter fail-closed
rules where a browser guess would be dangerous (verdicts, artifact URLs,
publish eligibility).

**Components** from `src/components/ui`: `Button` / `ButtonLink` (busy
labels), `Card` / `Surface`, `Dialog` (focus trap, Escape, focus
return), `EmptyState`, `ErrorSummary`, `TextInput` / `Select` /
`Checkbox`, `PageHeader`, `Progress`, `Skeleton`, `StatusMessage`
(danger announces as alert; `live={false}` for static panels),
`StatusPill`, `DataList` / `DataRow`; plus `ListingPhoto` ("Photo
unavailable", never a stock image), `SignInPrompt`, `CatalogEmptyActions`
and the `Shell` (`focused` for capture, mask and walk; `backTo` always
set on focused routes).

**Colour and type** per [DECISIONS D01 / D02](DECISIONS.md#2-open-decisions):
the shipped semantic palette (canvas, surface, accent surface, ink,
brand, divider, warning, danger) and Hanken Grotesk. Warning tone for
"needs attention" scan states; **never** the danger / claim red for a
failed scan; danger only for load and save failures like the rest of
the app. Tabular numerals on sizes, times and money.

**Motion and access** per the brief §6: stills first under
`prefers-reduced-motion`; no autoplayed camera; every 3D or map action
also available by keyboard and on-screen button; ≥ 44 × 44 CSS px
targets (48 px controls in practice); exactly one `h1` per route so
`RouteAnnouncer` lands focus correctly; time shown in the listing's
zone with the zone named.

**Server-authoritative facts** (never computed in the browser):
geofence verdict, scan state, `verified`, `scan_verified_at`, artifact
URLs, publish eligibility, pin precision, the nearby set, and the
platform kill-switch. The browser shows what the server returned and
otherwise says it is checking.

**Five facts stay five facts:** listing status (draft / active / paused),
front-door location confirmed, honesty scan verified, payout-ready,
platform bookings on. No screen collapses two of them into one pill or
one sentence.

---

## Coverage check for reviewers

| Brief §8 item | Where it is specified |
|---|---|
| Badge and disclosure strings locked | [journeys §1.1–1.5](JOURNEYS-AND-COPY.md#1-locked-strings-hm-00) |
| Capture permission and GPS-poor UI, no invented fix | [HM-D01 §4](screens/HM-D01.md), [journeys §2 branches](JOURNEYS-AND-COPY.md#branches) |
| Mask UI without an enhance control, even disabled | [HM-D05 §5, §8](screens/HM-D05.md) |
| Viewer fallbacks (motion, WebGL, failed job) | [HM-D06/D07 §4](screens/HM-D06-D07.md), [HM-D04 §3](screens/HM-D04.md) |
| Empty neighbourhood, no fake houses | [HM-D09 §4](screens/HM-D09.md) |
| Book / Reserve fail-closed until Nick flips the flag | [HM-D11 §3–§5](screens/HM-D11.md) |

Copyright 2026 Stead contributors.
