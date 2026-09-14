# Honesty media — screen inventory

**Status:** Skeleton for Claude Code to flesh out. Every row with
“Specify” is unfinished design work. Do not implement a screen from a
stub.

**Tickets:** [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md).
**Brief:** [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

Existing Stead routes stay. Add the fewest new URLs that keep capture
and walk bookmarkable. Proposed paths below are proposals — pick one
canonical URL per screen in the filled spec and use it consistently.

Copyright 2026 Stead contributors.

---

## How to fill a row

For each ID, add a subsection (or a linked `screens/HM-xx.md`) that
covers:

1. Purpose (one sentence) and primary CTA
2. Who can open it (owner / guest / public / signed-out)
3. Desktop layout and phone layout
4. States: loading, empty, GPS-poor, geofence fail, uploading,
   reconstructing, failed, verified, WebGL missing, reduced motion
5. Copy (exact strings; no banned voice; no “beautify”)
6. What the server must have already decided (never invent a verdict
   in the browser)
7. A11y: heading, focus, announcements
8. Hard stop (what this screen must never do)

Reuse global states from the redesign screen specs (loading skeletons,
retry, unauthorized) unless honesty media needs a stricter fail-closed.

---

## Inventory

| ID | Ticket | Route (proposed) | Surface today | Claude fills |
|---|---|---|---|---|
| HM-D00 | HM-00 | (copy system, not a route) | — | Disclosures, badge lock-string, banned UI verbs |
| HM-D01 | HM-01 | `/host/listings/:id/scan` | none | Capture client: camera + continuous geo + accuracy |
| HM-D02 | HM-01 | `/host/listings/:id` (editor step) | `HostListingEditPage` | Listing coordinates confirm; no silent IP proof |
| HM-D03 | HM-02 | `/host/listings/:id/scan` (upload) | none | Upload progress; attestation package; not a verdict |
| HM-D04 | HM-03 | `/host/listings/:id/scan/status` | none | Reconstructing / failed / retry — no preview splat |
| HM-D05 | HM-04 | `/host/listings/:id/scan/mask` | none | Rental vs private crop; whole-home confirm |
| HM-D06 | HM-05 | `/listing/:id` walk | `ListingDetailPage` | Spark indoor viewer + honesty badge |
| HM-D07 | HM-05 | `/listing/:id/walk` (optional) | none | Full-viewport indoor walk if detail overlay is too small |
| HM-D08 | HM-06 | `/listing/:id` approach | listing detail | MapLibre pin + host approach pano + door tether |
| HM-D09 | HM-07 | `/explore` walk mode **or** `/walk?city=` | `ExplorePage` | Neighborhood walk; nearby Stead pins only |
| HM-D10 | HM-08 | `/host/listings/:id` publish | editor | Publish blocked without verified scan |
| HM-D11 | HM-08 | `/book/:listingId` | `BookPage` | Still fail-closed without Nick’s flag; also refuse if no scan |
| HM-D12 | HM-09 | cards / detail / walk | `ListingCard`, detail | Honesty badge states |
| HM-D13 | HM-09 | `/host/listings` | `HostListingsPage` | Scan status on each home |

Existing routes **not** in this table stay as they are unless a filled
spec proves a one-line honesty mention is required (e.g. `/for-homeowners`
“A geo-proven scan is required before guests can book”). Do not redesign
payouts, claims, trips, or login in this phase.

---

## HM-D00 — Honesty policy surfaces (HM-00)

**Specify:**

- Host pre-capture sheet: what is stored (frames + location samples),
  why (prove this listing), what reconstruction will / will not do,
  private rooms, bookable-requires-scan.
- Guest badge + long disclosure (walk chrome and listing).
- Locked strings for “Geo-proven”, capture date (listing-local),
  whole-home vs partial.
- Explicit absence of Enhance / Beautify / Complete room controls.

**Hard stop:** Do not ship capture (HM-D01) without these strings.

---

## HM-D01 — Capture (HM-01)

**Specify:**

- Phone-first viewfinder. Start / pause / finish walk.
- Location accuracy meter (human units, not a fake courtroom seal).
- Outdoor bookend: start and end outside when indoor accuracy is poor.
- Permission denied, accuracy worse than threshold, too few samples.
- Binding to listing `lat` / `lng` (HM-D02). EXIF shown as supporting
  only.

**Hard stop:** Do not treat one EXIF tag as proven. Do not draw a public
breadcrumb. Do not invent coordinates when GPS is absent.

---

## HM-D02 — Listing coordinates (HM-01)

**Specify:**

- Owner-only fields for `lat` / `lng` (already in Postgres; not on the
  current editor contract).
- Confirm-on-map vs typed coordinates. “This is the door” language.
- What guests later see (pin precision vs full address — do not leak
  more than the listing already shows).

**Hard stop:** No silent IP geolocation as the listing coordinate.

---

## HM-D03 — Upload (HM-02)

**Specify:**

- Progress for frames / video / attestation package.
- Resume / fail / retry. Size-limit copy.
- Idle copy while the server has not returned an upload receipt.

**Hard stop:** Browser does not display “verified” from its own JSON.
Do not imply the Vercel function is uploading the raw video proxy.

---

## HM-D04 — Reconstruction status (HM-03)

**Specify:**

- States: queued, reconstructing, failed, ready-for-mask.
- Retry. Time-unknown honesty (“This can take a while”) — no fake ETA
  unless the worker reports one.
- Failed job: stills from **captured** frames only.

**Hard stop:** No generative “preview while we wait.” No Luma / closed
API branding. SuperSplat mentioned only as crop/compress if at all.

---

## HM-D05 — Rental vs private mask (HM-04)

**Specify:**

- Tools: paint / box / crop rental volume; mark private.
- Whole-home confirmation that matches listing type (recorded action).
- Before/after guest-visible crop. Re-mask requires re-verify copy.

**Hard stop:** No inpaint, beautify, or “tidy this room.” Crop / mask
only.

---

## HM-D06 / HM-D07 — Indoor walk (HM-05)

**Specify:**

- Entry from listing detail. Honesty badge always visible before enter.
- Spark + Three.js chrome: move, look, exit. Keyboard map.
- `prefers-reduced-motion`: stills or static orbit.
- No WebGL: captured stills + “Walkthrough needs a newer browser.”
- Unsigned-in guests may walk a **public verified** splat; drafts never.

**Hard stop:** No fetch-by-guess of unpublished splats. No invented
interior when the job failed.

---

## HM-D08 — Approach + door tether (HM-06)

**Specify:**

- MapLibre pin at listing coords.
- Host-captured approach pano (preferred) vs labeled third-party
  outdoor imagery (Panoramax / Photo Sphere Viewer).
- Door control: inside splat ↔ outside pano. Not a Google Street View
  product mark.

**Hard stop:** Mapillary not the sole outdoor layer. No draped invented
building.

---

## HM-D09 — Neighborhood walk (HM-07)

**Specify:**

- How Explore opens walk mode (toggle vs `/walk?city=`).
- Empty city: honest empty, two host CTAs if Dist is still empty.
- Pins = scan-verified public listings only. In-world open → HM-D06.
- Nearby query explanation (“Homes on Stead near this view”).

**Hard stop:** No generated street fabric, typical block, or seed
cottages.

---

## HM-D10 — Publish checklist (HM-08)

**Specify:**

- Checklist row: “Honesty scan verified” with link to HM-D01 / D04 / D05.
- Publish CTA disabled + reason when scan is missing / failed / needs mask.
- Distinct from payout-ready and from “Bookings aren’t open yet.”

**Hard stop:** Do not treat scan-verified as bookings-on.

---

## HM-D11 — Book path (HM-08 + existing kill-switch)

**Specify:**

- Keep current Soft Dist copy while `ALLOW_GUEST_BOOKINGS` is off:
  “Not open for bookings yet” — no Payment Element.
- After Nick flips the flag: if the listing is not scan-verified,
  refuse with a guest-safe reason (home not walk-verified yet).
- Quote may stay readable.

**Hard stop:** Do not change the kill-switch to accept `"true"` / `"yes"`.
Do not add a Book CTA that pretends Dist is live.

---

## HM-D12 — Honesty badge (HM-09)

**Specify:**

- Compact (card) and full (detail / walk) treatments.
- States: verified, processing (host-only), unavailable (no walk CTA).
- Capture date, stitch-not-invented line, whole-home vs partial.

**Hard stop:** Brass mark is not a Trust Passport and not a legal seal.

---

## HM-D13 — Host homes list (HM-09)

**Specify:**

- Per-row scan: not started / needs coordinates / capturing /
  processing / needs mask / verified / failed.
- Next action only (one link).

**Hard stop:** Do not show another host’s scan state. Do not show seed
homes as verified.

---

## Proposed new files Claude may add

```
design/honesty-media/JOURNEYS-AND-COPY.md
design/honesty-media/screens/   # optional one file per HM-D*
design/honesty-media/prototype/ # optional static HTML; illustrative only
```

Do not add application code while only filling this inventory.
When the inventory is specified, implementation follows BUILD-PLAN
on an implementation branch.

Copyright 2026 Stead contributors.
