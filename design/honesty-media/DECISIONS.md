# Honesty media — reconciliation and open decisions

**Status:** Design-phase record, ready for review. Written against
`main` at `1d6cc81` (PR #29 merged); this branch adds documentation only.
Every "today" statement below was read from source on this branch, not
measured on a live deployment. Production configuration has not been
re-verified.

**Companions:** [journeys and copy](JOURNEYS-AND-COPY.md) ·
[screen inventory](SCREEN-INVENTORY.md) ·
[build plan](../../docs/honesty-media/BUILD-PLAN.md).

Copyright 2026 Stead contributors.

---

## 1. What the current app already does (reconciled findings)

BUILD-PLAN §3 recorded findings at `31529cd`. Re-reading at `1d6cc81`
changes some of them. Implementation should start from this table.

| ID | Finding at `1d6cc81` | Consequence for the design |
|---|---|---|
| R01 | **Coordinates are already writable server-side.** `listingSchema` in `server/routes/listings.ts` accepts `lat` / `lng` (nullable, range-checked) on `POST` and `PATCH`, and `server/queries/hostListings.ts` persists them. What is missing: the browser's `ListingInput` / `ListingDetail` in `src/lib/types.ts` omit them, `src/lib/listingForm.ts` has no field, no page reads them, and nothing distinguishes "a value" from "a value the host confirmed is the door". BUILD-PLAN H01 is therefore half stale. | HM-01 / [HM-D02](screens/HM-D02.md) add the browser contract, the editor control, and a recorded confirmation (`coordinates_confirmed_at`, host-writable once, cleared when `lat` / `lng` change). No public read of raw coordinates in the MVP. |
| R02 | **Publish is a plain column update the host can make directly.** Both **Publish this home** buttons (`HostListingEdit` review step and the `HostListings` row) send `PATCH /api/listings/:id { status: "active" }`, and `listings_host_update` lets `app_user` update any column of its own row. A route-only check would leave the database willing to accept `active` from any authenticated request. | HM-08 enforces the scan gate **in the database** (see decision D04), and the two buttons get the checklist / next-action treatment in [HM-D10](screens/HM-D10.md) and [HM-D13](screens/HM-D13.md). |
| R03 | **The kill-switch strings are load-bearing.** `BOOKINGS_CLOSED_COPY` (`src/lib/guestBookings.ts`), `GUEST_BOOKINGS_CLOSED_MESSAGE` (`server/lib/guestBookings.ts`), the `data-testid="bookings-closed"` panel and `tests/guest-bookings.test.ts` regexes. `e2e/ui.spec.ts` asserts the closed panel on `/listing/:id`. | [HM-D11](screens/HM-D11.md) keeps all of it byte-for-byte and adds a *different* 409 for "not scan-verified" so the two gates stay distinguishable. |
| R04 | **Four facts are already rendered separately.** Listing status pill (Draft / Published / Paused), the payouts banner on `/host/listings`, the "Payouts are separate from publishing" surface on the review step, and the owner preview banner on `/listing/:id`. `/for-homeowners` FAQ explains payout readiness as a separate fact. | Honesty scan becomes a fifth row, never merged into any of those. Copy for the revised publish success line is in [journeys §3](JOURNEYS-AND-COPY.md#3-journey-h2--host-publish-blocked). |
| R05 | **Public DTOs carry no scan or coordinate field.** `ListingSummary` / `ListingDetail` (`server/queries/listings.ts`) expose neither; `HostListing` (`/api/listings/mine`) is a seven-field summary that `tests/listing-edit.test.ts` deliberately keeps thin. | Add `honesty` (public, server-derived, `null` unless verified and active) to summary and detail, and `scan` (owner-only) to `HostListing`. Shapes in §3. The dashboard summary still must not become the editor's hydration source. |
| R06 | **Storage is images only, single PUT, 300 s TTL, no size cap.** `server/lib/storage.ts` allows JPEG / PNG / WebP / AVIF, builds keys server-side, and `POST /:id/photos` checks the key prefix before attaching. | HM-02 adds a scan allowlist (video, JSON attestation, frames), the prefix `listings/:listingId/scans/:scanId/…`, the same prefix check on completion, and multipart presign for video (decision D06). The Hono function never proxies bytes. |
| R07 | **Worker writes have a precedent.** Platform-owned facts (`record_connect_readiness`, `record_payout`, conversion facts) are `SECURITY DEFINER` functions in schema `app`, granted to `app_user`, called from a non-member request (the webhook). Members hold no UPDATE grant on those columns. | Scan verdicts, artifact pointers and `verified` follow the same shape. How the worker reaches those functions is decision D03. |
| R08 | **The design system in code is the 2026-09 redesign, not `/design`.** `tailwind.config.js` defines canvas / surface / accent surface / brand / divider / warning / danger, marks `paper` / `spruce` / `brass` / `linen` / `claim` as transitional aliases with "Do not add new uses of an alias", and maps the display face to Hanken Grotesk. `index.html` loads only Hanken Grotesk. The redesign brief says "remove decorative gold stamps" and "replace the serif display treatment". | The honesty brief's §2 (brass for honesty marks, Ibarra display) conflicts with shipped code. Decision D01 picks the semantic palette; the brief is updated to say so. `CLAUDE.md`'s token line is stale for the same reason and is flagged in the return handoff rather than edited here. |
| R09 | **Universal states are specified and implemented.** `redesign-handoff/design/02-SCREEN-SPECS.md` §2, `RouteAnnouncer` (focus to `main h1`, polite title announcement), `StatusMessage` (danger = alert, else status; `live={false}` for static panels), `Skeleton` + sr-only status, `ErrorSummary`, `Dialog` (focus trap, Escape, restore), `SignInPrompt` after session resolves, `Button busy / busyLabel`. | Every honesty screen reuses these and adds only the fail-closed states honesty needs. Each new page has exactly one `h1`. |
| R10 | **Route metadata is a table.** `src/lib/routes.ts` maps patterns to document titles and workspaces; `isMemberRoute` already treats `/host/*` as private. `App.tsx` registers routes; the dev-only `/_ui` gallery is lazy. | New routes need a table row each (titles in §3) and lazy chunks for anything that pulls Three.js or MapLibre. |
| R11 | **Listing-local time helpers exist.** `date-fns-tz` `formatInTimeZone` is already used in `src/lib/dates.ts`. | "Captured {date}" uses it with the listing's `timezone`. |
| R12 | **Seed rows are hidden by id.** `server/lib/seedInventory.ts` hides Slice 1 ids unless `ALLOW_DEMO_LISTINGS=1`; owners can still open their own demo rows. | Seed rows never get a scan row (`scripts/seed.ts` must not insert one), the nearby query excludes hidden seed ids exactly like the catalog, and the owner view of a seed row shows "No honesty scan yet". |
| R13 | **Polling has a house style.** `/host/payouts` polls Stripe readiness 20 × 3 s after a return and ends in an honest "Stripe hasn't confirmed yet". | Scan status uses refetch-on-focus plus a manual **Check again**, not an unbounded interval: reconstruction takes hours, not seconds. Completion is emailed through the existing provider (decision D14). |
| R14 | **CI has no GPU or WebGL.** `.github/workflows/ci.yml` runs Vitest and Playwright on Chromium in a container. | The e2e that runs in CI exercises the no-WebGL fallback path by construction. The 3D path is a manual device check and is reported as such (BUILD-PLAN HM-09). |
| R15 | **The public listing JSON returns `addressLine` to anyone**, while the editor hint says the street address is "Shared with a guest after a stay is confirmed, not on the public page." The page does not render it, but the API does return it. Pre-existing; not introduced by this phase. | Out of honesty-media scope; queued as a separate task. HM-06 / HM-07 must not widen it (decision D09). |
| R16 | **`/for-homeowners` and `/host/start` describe the path in three steps** and never mention a scan. | One line each is added by HM-00 (see [HM-D00](screens/HM-D00.md) §6) so the first host is not surprised at the publish step. No redesign of those pages. |

---

## 2. Open decisions

Each decision has a recommendation so the implementing ticket is not
blocked; Nick can overrule any of them. "MVP" means the HM-00…HM-05,
HM-08, HM-09 bar from BUILD-PLAN §9.

| ID | Decision | Options | Recommendation and why | Owner / when |
|---|---|---|---|---|
| **D01** | Colour for the honesty badge and verified states | (a) brass `#B58B3E` per the honesty brief and `/design/DESIGN_HANDOFF.md`; (b) the shipped semantic palette: brand ink on accent surface, same as `StatusPill tone="brand"` | **(b).** The Tailwind config forbids new alias uses, the redesign removed gold stamps on purpose, and a brass mark next to evergreen pills would read as a foreign seal. The badge is text-led either way. If Nick wants a distinct honesty hue, it becomes a new semantic token (`verification`) added to the design system, not a revival of `brass`. | Nick, before HM-00 lands copy in the app |
| **D02** | Display typeface for honesty surfaces | (a) Ibarra Real Nueva per the brief; (b) Hanken Grotesk per the shipped system | **(b).** Ibarra is not loaded anywhere in the app. Adding a webfont for one feature contradicts the redesign. | Nick, with D01 |
| **D03** | How the reconstruction worker writes verdicts and artifact pointers | (a) a fourth database role (`scan_worker`) with EXECUTE on the `app.record_scan_*` functions only; (b) the worker calls an authenticated HTTP endpoint (`/api/scan-worker/*`, bearer `SCAN_WORKER_SECRET`, same shape as `/api/cron/*`) which runs as `app_user` and calls the `SECURITY DEFINER` functions | **(b).** It preserves the "three roles, never collapse them" invariant in `CLAUDE.md`, reuses the cron/webhook pattern, keeps the worker without any database credential, and lets the same worker run on a laptop, a container, or later Visual Rails without a Neon role per environment. Idempotency: the callback carries the scan id and a job attempt; the function refuses a stale attempt. | HM-03, decided in HM-02's contract |
| **D04** | Where the "no `active` without a verified scan" rule is enforced | (a) the `PATCH` route only; (b) a table constraint / trigger; (c) revoke column UPDATE on `listings.status` from `app_user` and move status changes into `app.set_listing_status(listing_id, next)` (`SECURITY DEFINER`) which checks `scan_verified_at` for `active` and records the transition | **(c).** R02 shows the route alone is not enforcement. A `SECURITY DEFINER` transition function is the house pattern for state changes ("a new transition means a new one of those" in `CLAUDE.md`). The same function is where revocation demotes to `paused` (D12). `listings_host_update` keeps working for every other column. | HM-08 migration |
| **D05** | Capture format | (a) phone video via `MediaRecorder` with location samples stamped to the recording clock, frames extracted by the worker with ffmpeg; (b) photo bursts from the browser | **(a).** One recording is easier for a host than hundreds of shots, gives the worker overlap for pose estimation, and frame extraction is stitching-class processing (allowed). iOS Safari 14.3+ and Android Chrome support `MediaRecorder`. The client also emits a small "camera notes" JSON (orientation, resolution, device class) — never a verdict. | HM-01 |
| **D06** | Upload transport and caps | (a) one presigned PUT with a hard cap; (b) S3 multipart presign (`CreateMultipartUpload`, per-part presigned PUTs, `CompleteMultipartUpload`), parts ≥ 5 MB, resumable | **(b)** with a 10-minute / 2 GB cap enforced at completion by reading the object size (a presigned PUT carries no size limit, as `storage.ts` notes). MinIO and R2 support multipart. The Hono function only signs. | HM-02 |
| **D07** | Geofence thresholds and where they live | Fixed constants vs `app_config` keys | **`app_config` keys**, snapshot onto the scan row: `scan_accuracy_max_m` (default 35), `scan_geofence_radius_m` (default 100), `scan_bookend_min_samples` (default 15 accurate samples in each of the first and last 90 s), `scan_min_indoor_seconds` (default 60), `scan_max_seconds` (default 600). Defaults are starting points to tune with real phones in HM-01; nothing here is calibrated. Distances are integer metres; no float money anywhere near this. | HM-01, tuned by Nick with phones |
| **D08** | Map tiles and geocoding provider | MapLibre needs a tile source (OpenFreeMap, self-hosted Protomaps PMTiles, MapTiler key…); a map picker or address cross-check needs a geocoder (self-hosted Photon / Nominatim, or a keyed service) | **Defer maps to HM-06.** In the MVP the coordinate step ([HM-D02](screens/HM-D02.md)) uses **Use my location here** at the door plus typed coordinates, with no tiles. HM-06 picks a tile provider whose licence is verified at pin (the OSM tile usage policy forbids production use of the public tile server) and can then upgrade D02 to a drag-pin picker. Geocoder: not required for the MVP; the address-to-coordinates cross-check is recorded as a known limit (below). | Nick, before HM-06 |
| **D09** | Public precision of the pin and the approach footage vs the address promise | (a) exact pin and door footage public for every verified home; (b) per-listing host choice, default "after a stay is confirmed"; nearby pins rounded to a ~150 m grid until then | **(b).** The editor promises the street address is not on the public page. A walk to the front door in 3D is the address. Default private, host opt-in public. The indoor walkthrough is unaffected. | Nick, before HM-06 |
| **D10** | How a host masks private areas on a phone | (a) 3D box crop only (SuperSplat-style, desktop-friendly); (b) mark private **moments** of the walk on a timeline, worker drops those frames before reconstruction, plus whole-home confirmation; (c) both, segments first | **(c).** Timeline segments work on a phone, keep private frames out of the reconstruction entirely, and are still crop-class processing. Box crop is the desktop refinement in the same ticket if SuperSplat's headless crop is confirmed at pin; otherwise it slips to HM-09 without blocking publish. | HM-04 |
| **D11** | Which listing types may use whole-home confirmation | `entire_home` and `apartment` may; `private_room` must mask | As stated. A private room is partial by definition. | HM-04 |
| **D12** | What revocation does to the listing | (a) clear verification, leave `active`; (b) clear verification and set `paused` in the same function | **(b)** so "active ⇒ verified" holds and [HM-D11](screens/HM-D11.md)'s not-verified refusal is defensive rather than a routine state. Host is emailed. | HM-08 / HM-09 |
| **D13** | Existing `active` rows without a scan when HM-08 ships | Production has none (empty catalog). Staging / local may. | Migration demotes any `active` row without `scan_verified_at` to `paused` and the dashboard shows the "Not started" next action. No grandfathering path is built. | HM-08 |
| **D14** | Completion notifications | None / email / push | **Email** through the existing provider (`server/lib/email.ts`), one message per terminal state (`needs_mask`, `verified`, `rejected`, `failed`), subject lines in [HM-D04](screens/HM-D04.md). No new provider. | HM-03 |
| **D15** | Keeping the screen awake and the tab alive during capture | Screen Wake Lock API where available (iOS 16.4+, Chrome); otherwise instruct the host | Use it when available, always show "Keep the screen on and this page open". If `watchPosition` stops (backgrounded tab), pause the recording and say so; do not stitch across a gap silently. | HM-01 |
| **D16** | Raw footage retention | Keep forever / delete after artifact / delete after a grace period | **Delete the raw recording 30 days after `verified`** (or immediately on host request); keep the attestation package, frames the mask allowed, and the artifact. Rejected / failed scans keep raw footage 30 days for **Walk again** comparisons, then delete. Owner-only throughout. | HM-02 / HM-09 runbook |
| **D17** | C2PA content credentials | Sign the attestation package in the MVP or later | **Later.** The geofence verdict is the MVP signal; c2pa-js at pin is an HM-09 candidate. Copy never mentions it until it exists. | HM-09 |
| **D18** | Does scanning require Stripe Identity tier 2? | Yes / no | **No.** Scan proves the walk; identity proves the person; payouts prove the account. Keeping them separate is the whole point of the four-facts rule. | HM-01 |
| **D19** | Neighbourhood walk entry | (a) `/explore?walk=1`; (b) a dedicated `/walk?city=` route | **(b).** A dedicated route lazy-loads MapLibre away from Explore, is bookmarkable, and can show the honest empty state without pretending to be a filter. Explore offers **Walk {city}** only when a verified home is in the results. | HM-07 |
| **D20** | Indoor viewer placement | (a) inline on `/listing/:id`; (b) a full-viewport `/listing/:id/walk` route with a poster + CTA on detail | **(b).** A 3D canvas inside a scrolling page fights touch gestures and pays the Three.js cost on every detail view. The route is focused-shell with a Back to the home. | HM-05 |
| **D21** | Third-party outdoor imagery in the MVP | Include Panoramax / Photo Sphere Viewer in HM-06 or host footage only | **Host footage first.** The outdoor bookends the geofence already requires are the approach capture. Third-party imagery is an HM-07 layer, labelled with its source, never the only layer, never a façade stand-in. | HM-06 / HM-07 |

### Known limits recorded on purpose

- The geofence binds the walk to the coordinates **the host confirmed**.
  Whether those coordinates match the stated street address is a
  separate question that needs a geocoder (D08). Until then the map in
  HM-06 makes the pin visible to guests, which is a social check, not a
  technical one. Copy never claims more.
- Indoor GPS is expected to be poor. The design accepts a walk whose
  outdoor bookends are good and whose indoor samples drift within the
  radius; it rejects a walk that never had a good fix. That is a
  provenance signal, as BUILD-PLAN §4 says, not proof.
- A determined host could film one property while standing at another
  set of confirmed coordinates only by carrying the phone there, which
  is the property the pin shows. That is the intended trade.

---

## 3. Contract deltas by ticket

Names are proposals for reviewability; the implementing ticket owns the
final names. Nothing in this section is implemented on this branch.

### Routes (browser)

| Route | Screen | Title (`src/lib/routes.ts`) | Workspace | Chunk |
|---|---|---|---|---|
| `/host/listings/:listingId/scan` | HM-D01, HM-D03 | Scan your home | hosting | lazy (camera + upload code) |
| `/host/listings/:listingId/scan/status` | HM-D04 | Scan progress | hosting | eager |
| `/host/listings/:listingId/scan/mask` | HM-D05 | Mark private rooms | hosting | lazy (viewer) |
| `/listing/:id/walk` | HM-D06/D07 | Walk through this home | renter | lazy (Spark + Three.js) |
| `/walk` (`?city=`) | HM-D09 | Walk a neighbourhood | renter | lazy (MapLibre) |

`/listing/:id`, `/book/:listingId`, `/host/listings`,
`/host/listings/:listingId` gain sections, not routes.

### Public DTO additions (`src/lib/types.ts`)

```ts
/** Server-derived. null unless the listing is active and its scan is verified. */
export type ListingHonesty = {
  capturedOn: string;          // "YYYY-MM-DD" in the listing's time zone
  coverage: "whole_home" | "rental_area";
  hasApproach: boolean;        // HM-06: host approach footage exists and is public per D09
};
// ListingSummary and ListingDetail gain: honesty: ListingHonesty | null;

export type WalkthroughResponse = {
  listingId: string;
  honesty: ListingHonesty;
  artifactUrl: string;         // short-lived signed URL, never a bucket path
  stills: { url: string; index: number }[]; // real captured frames chosen by the worker
  approach: { artifactUrl: string; stills: { url: string; index: number }[] } | null;
  expiresInSeconds: number;
  ownerPreview: boolean;       // true only when the owner opens a non-active listing
};
```

### Owner DTO additions

```ts
export type ScanState =
  | "capturing" | "uploaded" | "reconstructing" | "needs_mask"
  | "verified" | "rejected" | "failed";

export type ListingScan = {
  id: string;
  state: ScanState;
  coordinatesConfirmed: boolean;
  reason: string | null;       // locked string key for rejected / failed
  capturedOn: string | null;
  verifiedAt: string | null;
  uploadedParts: { video: boolean; attestation: boolean; notes: boolean };
  whole_home_confirmed: boolean;
};
// HostListing gains: scan: ListingScan | null;  (owner-only summary; not an editor hydration source)
// ListingDetail gains, for the owner only: coordinates: { lat: number; lng: number; confirmedAt: string | null } | null
// ListingInput gains: lat?: number | null; lng?: number | null; (already accepted by the server)
```

### API (Hono, under `/api`)

| Method and path | Who | Purpose | Screen |
|---|---|---|---|
| `PATCH /listings/:id` | owner | already accepts `lat` / `lng`; HM-01 adds `confirmCoordinates: true` which sets `coordinates_confirmed_at` | HM-D02 |
| `GET /listings/:id/scan` | owner | current scan summary (`ListingScan`) | HM-D01, D03, D04, D05, D13 |
| `POST /listings/:id/scan` | owner | create a scan row in `capturing`; 409 without confirmed coordinates; 503 without storage | HM-D01 |
| `POST /listings/:id/scans/:scanId/uploads` | owner | presign a part: `{ kind: "video" \| "attestation" \| "notes", contentType, partNumber? }` → key under the scan prefix | HM-D03 |
| `POST /listings/:id/scans/:scanId/complete` | owner | validate the package is whole (sizes, types, prefix), compute the geofence verdict server-side, set `uploaded` or `rejected`, enqueue | HM-D03 |
| `POST /listings/:id/scans/:scanId/mask` | owner | persist segments / boxes / `wholeHomeConfirmed: true`; re-enqueue crop | HM-D05 |
| `POST /listings/:id/scans/:scanId/retry` | owner | idempotent retry of a `failed` job | HM-D04 |
| `GET /listings/:id/walkthrough` | public (owner for own drafts) | `WalkthroughResponse`; 404 unless verified + active, or owner | HM-D06/D07, D08 |
| `GET /walk/nearby?lat&lng&radiusM` | public | pins over verified, active, non-seed listings; public-safe fields; pin precision per D09 | HM-D09 |
| `POST /scan-worker/jobs/:scanId` | worker (bearer secret) | worker callback per D03: `{ attempt, outcome, artifacts…, stills… }` | HM-03 |
| `POST /listings/:id/publish` *(or `PATCH` mapped to it)* | owner | calls `app.set_listing_status(id, 'active')`; 409 with the locked message when not verified | HM-D10, D13 |

### Tables (append-only migration; every one gets RLS + a raw-SQL probe)

| Table | Rows written by | Client can | Notes |
|---|---|---|---|
| `listing_scans` | host (insert `capturing`), server / worker (everything else via `SECURITY DEFINER`) | SELECT own; INSERT own with `state = 'capturing'` only | state machine `capturing → uploaded → reconstructing → needs_mask → verified / rejected / failed`; `honesty_policy_version`; snapshot of D07 thresholds; `captured_on` (listing-local date) |
| `scan_geo_samples` | server at completion (from the uploaded attestation) | nothing (no SELECT grant for guests; owner SELECT optional for debugging) | sequential samples with accuracy and whether each cleared the fence; **never** served to other members |
| `scan_artifacts` | worker via function | SELECT own; public read only through the walkthrough endpoint's signed URLs | object keys for video, frames, cameras, splat, compressed splat, stills, approach |
| `listing_rental_masks` | host (upsert own while `needs_mask` or `verified`) | SELECT / INSERT / UPDATE own | segments, boxes, `whole_home_confirmed_at` |
| `listings` | — | — | add `scan_verified_at timestamptz`, `coordinates_confirmed_at timestamptz`; **revoke** column UPDATE on `status` from `app_user` (D04) |

RLS probes to add in `tests/rls.test.ts`: another host cannot read or
update a scan row, a mask, or an artifact pointer; a guest cannot read
`scan_geo_samples` at all; `app_user` cannot set `state = 'verified'` or
`scan_verified_at` directly; `app_user` cannot set `status = 'active'`
directly after D04.

### Config (`app_config`)

D07 keys, plus `honesty_policy_version` (integer) snapshotted onto each
scan so a later copy change does not retroactively change what a host
agreed to.

### Environment

`SCAN_WORKER_SECRET` (D03). No change to `ALLOW_GUEST_BOOKINGS`
semantics, defaults, docs, or `.env.example` recommendations.

---

## 4. Test map

| Area | Kind | What it proves |
|---|---|---|
| Geofence maths | Vitest (`tests/scan-geofence.test.ts`) | haversine in integer metres; accuracy gate; bookend windows; too-few-samples; cluster-away; a single EXIF tag never verifies |
| Scan state machine | Vitest over the `SECURITY DEFINER` functions | only the enumerated transitions; stale worker attempt refused; `verified` writes `scan_verified_at`; revoke demotes to `paused` |
| Publish gate | Vitest (HTTP) | `active` refused without `scan_verified_at` (409, locked message); allowed after; `tests/guest-bookings.test.ts` unchanged and green |
| Book gate | Vitest (HTTP) | with `ALLOW_GUEST_BOOKINGS=1` in test, create-booking still refuses a non-verified listing with the second 409 |
| RLS | raw SQL as `app_user` | the probes listed in §3 |
| Storage | Vitest | scan keys under the scan prefix; content-type allowlist; completion refuses a foreign prefix and a missing part |
| Copy | Vitest | locked strings exported; no banned verb in the honesty copy module; `BOOKINGS_CLOSED_COPY` untouched |
| Browser | Playwright (mock Stripe, no WebGL) | cannot publish without a scan; dashboard next action per state; walk route renders the stills fallback and the disclosure; reduced-motion default; owner preview banner; `/walk?city=` empty city shows the host actions |
| Manual (report, never mark passed) | phone + desktop | real capture on iOS Safari and Android Chrome; indoor GPS behaviour; wake lock; a real multipart upload; a real reconstruction; the 3D walk on a WebGL device; screen reader on the capture flow; measured contrast of the badge |

Copyright 2026 Stead contributors.
