# Honesty media — Soft Dist build plan

**Deliverable:** an implementation brief for a later coding agent. This
document proposes work; it does not claim that work has shipped, and it
does not authorize application code, migrations, or seed in this PR.

**Code baseline:** `nsheinbe/stead` `main` at
`31529cd` (merge of #28, Soft Dist guest-booking kill-switch). Reconcile
the current branch against that commit before implementation. Test
commands below are instructions to a future builder, not evidence that
those tests ran for this document.

**Authorization:** Nick, 2026-09-14 — “Make build plan” / “On new
branch” for Soft Dist honesty media. The Soft Dist launch criterion is a
**required** geo-proven property scan for every host before a home can
be bookable. Bookings stay off until Nick sets `ALLOW_GUEST_BOOKINGS=1`
**after** this ships and is required. Do not flip that flag in any
honesty-media ticket.

OSS stack recommendations are from Nick’s research on 2026-09-14.

Copyright 2026 Stead contributors.

---

## 1. Outcome and product frame

Stead is a community-owned, open-source home rental marketplace (not a
protocol product). Stays are monthly: **≥ 30 nights**. Live stay charges
are Stripe Connect destination charges with the **host as merchant of
record**. Honesty media is the missing trust surface: a guest should be
able to walk a real place, not a rendered brochure.

### Host

1. Walk-scan the property on a phone (video / photo).
2. Geo-prove the capture at the listing’s coordinates (continuous
   geolocation with an accuracy gate; EXIF alone is not proof).
3. Mark rental area(s) versus private rooms, or confirm whole-home.
4. Publish a 3D walkthrough plus a Street View–style outdoor walk
   tethered to the indoor splat.

### Guest

- Virtually walk neighborhoods in cities they are searching.
- Walk through **geo-proven** Stead rentals.
- Discover nearby Stead rentals **in-world** (spatial query over real
  listings — no invented buildings).

### Reconstruction AI (hard policy)

Allowed: stitch, stabilize, compress, crop, and cleanup of captured
frames.

Forbidden: beautify, generative fill, invented rooms, invented
furniture, invented façades, or any model that synthesizes geometry the
host did not capture.

Disclosure copy must say this in host and guest surfaces. A listing
without a verified scan is not bookable. A verified scan is a
**provenance signal**, not courtroom GPS.

### Two independent booking gates

| Gate | Who flips it | Meaning |
|---|---|---|
| Platform kill-switch `ALLOW_GUEST_BOOKINGS` | Nick only, on Vercel Production | Unset or any value other than `1` refuses create-booking fail-closed. **This plan does not change that behavior.** |
| Listing scan-verified | Implementation of HM-08 | A home cannot become bookable (and should not become `active` for guests) without a required geo-proven scan. |

Nick may turn bookings on only after the scan requirement is live. Even
then, a listing without a verified scan stays closed.

---

## 2. Instructions for the building agent

1. Read `CLAUDE.md`, the stack amendment in `BUILD_PROMPT.md`,
   `README.md`, `docs/soft-launch.md`, and this plan. Keep money,
   30-night, Connect host-MOR, RLS, and append-only migration invariants.
2. This PR is **docs only**. A later implementation branch starts at
   HM-00. Do not mix honesty-media schema into an unrelated slice.
3. Ticket size is a reviewable slice, not a calendar estimate. Priority
   P0 is a launch-criterion or honesty/security blocker; P1 is required
   for the full Soft Dist product bar.
4. Keep React 18, Vite, React Router, TanStack Query, Hono, Drizzle,
   Neon Postgres, Auth.js email links, S3-compatible uploads, and Stripe
   Connect. Inspect installed versions. Do not upgrade the app stack
   merely to pull in a viewer library.
5. Heavy reconstruction (COLMAP, splatfacto / gsplat) does **not** run
   inside a Vercel request. Propose a worker. Visual Rails is an
   **optional later** compute home if Nick wants it — do not assign
   tickets to Visual Rails in this plan, and do not block HM-03 on them.
6. Banned product voice: blockchain, crypto, wallet, token, web3, DAO,
   smart contract, on-chain, gas. Use: geo-proven walkthrough, honesty
   scan, community-owned, open source, Trust Passport, independent
   arbitration.
7. Every new tenant table gets deny-by-default RLS and a raw-SQL
   adversarial probe in `tests/rls.test.ts` in the same append-only
   migration. Clients cannot write scan-verified, published splat
   pointers, or geo-attestation verdicts directly — those go through
   enumerated `SECURITY DEFINER` functions or a privileged worker role
   that is not `app_user` and is not the table owner used as
   `DATABASE_URL`.
8. `listings.lat` / `listings.lng` already exist (nullable
   `double precision` in `drizzle/0001_init.sql`) but are **not** on the
   current `ListingInput` / `ListingDetail` contract. Add them only
   through a deliberately scoped ticket (HM-01 / HM-08), with owner-write
   and public-read rules that do not leak a precise street address beyond
   what the listing already shows.

---

## 3. Current findings versus proposals

Source observations at the baseline. They are not measurements of live
hosts — Soft Dist production inventory is empty on purpose.

| ID | Observed at baseline | Consequence | Proposed owner |
|---|---|---|---|
| H01 | `listings.lat` / `lng` exist; frontend create/edit contracts omit them (`docs/redesign/BASE-01-baseline.md` §6c). | A geofence cannot bind to a listing until coordinates are a first-class, validated host field. | HM-01, HM-08 |
| H02 | Photo upload is presigned S3 (`POST /api/listings/:id/photo-upload` → PUT → attach). The API never proxies image bytes. | Scan frames, camera lists, and attestation packages should reuse that pattern, with new prefixes and content-type allowlists. Do not stream video through the Hono function. | HM-02 |
| H03 | Listings may become `active` before payout-ready. Create-booking already fails closed without a host Connect `acct_` **and** without `ALLOW_GUEST_BOOKINGS=1`. | “Published,” “scan-verified,” “payout-ready,” and “bookable” are four facts. HM-08 adds scan-verified. It must not collapse them or open the platform kill-switch. | HM-08 |
| H04 | Explore is catalog filters only — no date availability, no coordinates on the public listing DTO. | Neighborhood discovery (HM-07) needs a new spatial read, not a silent change to `GET /api/listings`. | HM-07 |
| H05 | `ALLOW_GUEST_BOOKINGS` is exact-`1` only (`server/lib/guestBookings.ts`). Tests in `tests/guest-bookings.test.ts`. | Honesty-media work must keep those tests green. Do not treat `"true"` / `"yes"` as on. | HM-08, HM-09 |
| H06 | Slice 1 demo homes are hidden unless `ALLOW_DEMO_LISTINGS=1` (never Production). | Do not seed invented walkthroughs or Santa Monica (or other strict-enforcement) cities to demo the viewer. | HM-00, HM-09 |

---

## 4. Honesty policy (owned by HM-00; inherited by every ticket)

Write this as committed product copy and an engineering checklist before
any capture client lands.

**Hosts see, before the first frame:**

- What is captured (frames + continuous location samples).
- That location is used to prove the walk happened at this listing, not
  to publish a live track to guests.
- That reconstruction may stitch and stabilize, and will not invent
  rooms.
- That private areas they mask will not appear in the guest walkthrough.
- That a listing cannot be bookable without a verified scan.

**Guests see, on every walkthrough:**

- An honesty badge: geo-proven at the listing, captured by the host,
  reconstruction limited to stitch / stabilize / compress / cleanup.
- Capture date (listing-local), not a fake “live now.”
- Whole-home versus partial-home: which rooms are in the rental.
- That nearby pins are other Stead listings, not generated street fabric.

**Hard stops for every model and UI control:**

- No “enhance,” “beautify,” “complete the room,” or inpainting toolbar.
- No generative fill of missing walls, windows, or furniture.
- SuperSplat (HM-03 / HM-04) is crop + compress only.
- A failed reconstruction is an honest retry, not a hallucinated mesh.
- Provenance (geofence + optional C2PA content credentials) is a
  **signal**. Copy must not claim courtroom-grade GPS, anti-tamper
  hardware proof, or that Play Integrity / App Attest (optional later)
  make the capture incontestable.

---

## 5. Recommended OSS stack (Nick research, 2026-09-14)

Prefer this stack unless a later ticket records a license or technical
blocker and Nick approves a substitute from the same class.

| Layer | Recommended | License (verify at pin) | Role |
|---|---|---|---|
| Capture | Phone video / photo + continuous Geolocation | Platform APIs | Frames + accuracy-gated location samples. EXIF GPS is supporting metadata, not proof. |
| Pose | [COLMAP](https://github.com/colmap/colmap) | BSD-3-Clause | SfM cameras. Alternative: OpenMVG (research the current license before pinning). |
| Dense / splat | [Nerfstudio](https://github.com/nerfstudio-project/nerfstudio) `splatfacto` + [gsplat](https://github.com/nerfstudio-project/gsplat) | Apache-2.0 | Train → `.ply`. |
| Splat cleanup | [SuperSplat](https://github.com/playcanvas/supersplat) | MIT (verify at pin) | Host crop / compress only. No generative edit. |
| Indoor web | [Spark](https://github.com/sparkjsdev/spark) (`@sparkjsdev/spark`) + Three.js | Check Spark LICENSE at pin; Three.js is MIT | Listing-detail 3D walk. |
| Neighborhood | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) + [Panoramax](https://panoramax.fr/) and/or [Photo Sphere Viewer](https://github.com/photo-sphere-viewer/photo-sphere-viewer) | MapLibre BSD-3; confirm Panoramax / PSV licenses at pin | Outdoor approach and city walk. Host-captured approach panos preferred over third-party imagery when both exist. |
| Provenance | Geofence gate + [c2pa-js](https://github.com/contentauth/c2pa-js) | Apache-2.0 (verify) | Sign / read content credentials on the attestation package. Optional later: Play Integrity / App Attest — not in the MVP critical path. |

Worker runtime is unspecified on purpose. A Linux box, container, or
(later) Visual Rails GPU job can host COLMAP + splatfacto. This plan
does not pick a vendor.

### Hard avoid

| Item | Why |
|---|---|
| INRIA 3D Gaussian Splatting reference (non-commercial) | NC license — cannot be Stead’s reconstruction core. |
| DUSt3R / MASt3R (NC) | Same class of license problem. |
| Luma (or similar) closed reconstruction APIs | Closed model, beautify risk, no self-host path. |
| OpenMVS as the SaaS reconstruction core | AGPL — do not make it the hosted service’s core. |
| Mapillary as the **sole** outdoor layer | Do not depend on one commercial street-level vendor for Soft Dist. Host approach panos + MapLibre + Panoramax / PSV. |
| Generative room invent (any image/video model that synthesizes unseen interiors) | Honesty policy. |

License pins belong in the implementation PR that adds the dependency
(and in HM-09’s runbook). Re-read LICENSE files at the chosen commit;
this table is a research snapshot, not legal advice.

---

## 6. Non-negotiable Stead boundaries

Inherited by every HM ticket. Ask Nick before any deviation.

- All money remains integer cents. Honesty media does not quote, charge,
  or alter `guest_total_cents`. Pricing stays on the server.
- Minimum stay remains 30 nights in UI, quote, create-booking, and the
  `nights >= 30` check. Do not expand below 30.
- Live stay charges stay Connect destination charges:
  `on_behalf_of` + `transfer_data.destination` + `application_fee_amount`.
  Fail closed without `stripe_connect_account_id`. No platform-MOR
  fallback.
- `ALLOW_GUEST_BOOKINGS` stays fail-closed until Nick sets `1` on
  Production. Honesty-media tickets do not set it, default it on, or
  treat preview env as a reason to change Production.
- RLS is deny-by-default. `DATABASE_URL` remains `app_user` (no
  `BYPASSRLS`). Owner connection is migrations only.
- Webhooks stay idempotent via `stripe_events`. Do not overload that
  table for scan jobs.
- Listing-local IANA time zone for any “captured on” display.
- Migrations are append-only numbered files in `drizzle/`. Schema in
  `server/db/schema.ts` mirrors them. Next file after the current
  journal — do not edit applied SQL.
- No seed of fake walkthroughs on Production. `ALLOW_DEMO_LISTINGS`
  stays off there. Do not invent ratings, streets, or rooms.

---

## 7. Proposed data and storage (implementation, not this PR)

Sketch only. Exact names are the implementing ticket’s job.

**Likely new tenant tables** (each with RLS + grants + adversarial
tests):

- `listing_scans` — listing id, host id, state machine
  (`capturing` → `uploaded` → `reconstructing` → `needs_mask` →
  `verified` / `rejected` / `failed`), capture bounds, geofence result,
  reconstruction artifact pointers, honesty-policy version.
- `scan_geo_samples` or an object-store attestation package — sequential
  location samples with accuracy, timestamp, and whether each sample
  cleared the listing geofence. Verdict is computed server-side.
- `scan_artifacts` — object keys for frames, COLMAP cameras, splat
  `.ply` / compressed splat, approach panos, C2PA sidecar if stored
  apart from the media.
- `listing_rental_masks` — host-authored rental versus private volume
  (crop / mask), required unless listing type is whole-home and the host
  confirms the whole capture is the rental.

**Object storage:** extend the existing S3-compatible `S3_*` bucket
(MinIO locally). Proposed key prefix
`listings/:listingId/scans/:scanId/…`. Presign uploads; worker reads
server-side. Do not put splat bytes in Postgres.

**State changes** the browser must not write: geofence pass/fail,
reconstruction success, `verified`, public splat URL, publish/bookable
derived from scan. Host may start a capture, upload, draw a mask, and
request publish. The server (or worker via a narrow function) sets
verdicts.

**Existing listing statuses** (`draft`, `active`, `paused`) stay. Add a
derived or stored `scan_verified_at` (or equivalent). Do not invent a
booking status for “waiting on scan.”

---

## 8. Dependency-ordered backlog

Every ticket inherits §4 (honesty) and §6 (Stead invariants). Completion
evidence is what a reviewer can check. Hard stops abort the ticket
rather than “do it later in the same PR.”

### Suggested execution order

1. Policy and contracts: **HM-00**.
2. Capture and proof: **HM-01 → HM-02**.
3. Reconstruction: **HM-03**, then host mask **HM-04**.
4. Indoor guest viewer: **HM-05**.
5. Launch-criterion gate: **HM-08** (can start schema work after HM-00;
   must not enable bookings).
6. Outdoor + neighborhood: **HM-06 → HM-07**.
7. QA, badges, runbook: **HM-09** (badges may land with HM-05; the
   runbook closes the phase).

Independent file ownership only: HM-05 UI can proceed against fixture
splats **after** HM-00 forbids generative fixtures. A fixture splat used
in tests must be labeled as a test capture, never shown as a real Dist
home.

### HM-00 — Scope + honesty policy

| | |
|---|---|
| **Priority / deps** | P0 / none |
| **Scope** | Lock product copy, disclosure strings, and the no-generative-fill rule. Add `docs/honesty-media/` policy notes the UI will import or mirror. Decide badge wording (“Geo-proven walkthrough” or equivalent — no banned voice). Record MVP versus full Soft Dist bar (see §9). Confirm copyright line: Copyright 2026 Stead contributors. |
| **File map (proposed)** | `docs/honesty-media/` (policy appendix), later `src` copy modules only when implementation starts. No `drizzle/`, no seed. |
| **Acceptance** | Written host and guest disclosures. Explicit ban list for model features and UI verbs. Reviewer can quote the rule “stitch / stabilize / compress / cleanup only.” Soft Dist criterion stated: required scan before bookable; `ALLOW_GUEST_BOOKINGS` remains Nick-gated. |
| **Hard stop** | Do not start a capture client that can upload before this copy exists. Do not add a beautify control “disabled for later.” |

### HM-01 — Capture client + continuous geo + listing geofence gate

| | |
|---|---|
| **Priority / deps** | P0 / HM-00 |
| **Scope** | Host-only capture surface (likely `/host/listings/:id` scan step). Phone video and/or burst photo. Continuous `Geolocation` while capturing, with an accuracy gate (reject / warn when accuracy radius is worse than the configured threshold). Bind samples to `listings.lat` / `lng` (add validated owner write of coordinates if still missing). EXIF GPS may be stored and shown as supporting metadata; it **must not** alone mark the scan geo-proven. |
| **File map (proposed)** | Host editor / new scan route; listing coordinate fields on owner PATCH; server geofence helper with integer or well-defined meters, no float money. Tests for accuracy-fail, too-few-samples, and center-too-far. |
| **Acceptance** | A capture that never gets an accurate fix cannot become verified. A capture whose samples cluster away from the listing coordinates fails the geofence. Owner can set listing coords once, with confirmation — no silent IP geolocation as proof. |
| **Hard stop** | Do not treat a single EXIF tag as proof. Do not publish raw breadcrumb tracks to other members. Indoor GPS will be poor — see §11; the gate must fail closed or require outdoor bookends, not invent a fix. |

### HM-02 — Upload pipeline + object storage

| | |
|---|---|
| **Priority / deps** | P0 / HM-01 |
| **Scope** | Presigned upload for frames (and, if needed, a short video blob), camera/pose sidecar if the client emits one, and the geo attestation package (samples + client environment, not a verdict). Reuse `server/lib/storage.ts` patterns: server chooses object key and content type. New prefixes; size and type limits; owner-only create. |
| **File map (proposed)** | `server/lib/storage.ts` (or sibling), `server/routes/` scan upload, RLS on new tables, `tests/storage` + `tests/rls` probes. |
| **Acceptance** | Browser never writes a public splat path. Another member cannot list or overwrite someone else’s scan prefix. Incomplete packages cannot skip to reconstruction. |
| **Hard stop** | Do not proxy multi-hundred-MB video through the Vercel function. Do not store attestation verdicts in the client-owned JSON as authoritative. |

### HM-03 — COLMAP → gsplat / splatfacto worker

| | |
|---|---|
| **Priority / deps** | P0 / HM-02 |
| **Scope** | Offline worker: COLMAP (or approved OpenMVG alt) for pose, then Nerfstudio splatfacto + gsplat → `.ply`. SuperSplat (CLI or documented headless path) for compress / crop **only**. Job state on `listing_scans`. Idempotent retries. Logs without PII dumps of the home. |
| **File map (proposed)** | Worker package or `server/workers/` (exact layout TBD). Not a Hono request handler. Optional later: run the same job on Visual Rails — **not assigned here**. |
| **Acceptance** | A successful job produces a splat artifact pointer and a camera list. A failed job stays `failed` with a retry action. No network call to Luma or other closed reconstruction APIs. License files recorded for COLMAP, gsplat, Nerfstudio, SuperSplat at the pinned revisions. |
| **Hard stop** | INRIA 3DGS NC, DUSt3R/MASt3R NC, OpenMVS-as-core, any generative completion step. Do not block this ticket on Visual Rails access. |

### HM-04 — Host rental versus private mask / crop UI

| | |
|---|---|
| **Priority / deps** | P0 / HM-03 |
| **Scope** | After a splat exists, the host marks rental volume(s) versus private (or confirms whole-home). SuperSplat crop or an in-app mask that the worker applies. Publish of the guest walkthrough is gated on a completed mask **or** an explicit whole-home confirmation that matches listing type. |
| **File map (proposed)** | Host scan review UI; mask persistence; worker apply-crop. |
| **Acceptance** | Private rooms do not appear in the artifact served to guests. Changing the mask requires re-verification, not a silent overwrite of a live walkthrough. Whole-home confirmation is a recorded host action, not a default. |
| **Hard stop** | No “AI, hide the messy bits” that in-paints or replaces geometry. Crop / mask only. |

### HM-05 — Spark indoor viewer (listing detail)

| | |
|---|---|
| **Priority / deps** | P0 / HM-00, HM-03 (fixture allowed for UI-only after HM-00); production data needs HM-04 |
| **Scope** | Web viewer on listing detail using Spark + Three.js. Load only scan-verified, mask-applied splats. Keyboard, reduced-motion (static orbit or stills — do not force a moving camera), and a fallback when WebGL is missing. Honesty badge copy from HM-00. |
| **File map (proposed)** | `src` listing detail; lazy-loaded viewer chunk so Explore does not pay the 3D cost. |
| **Acceptance** | Guest can walk the captured interior. No unpublished / unverified splat is fetchable by id guessing (signed URLs or authz on the artifact). Reduced-motion path exists. |
| **Hard stop** | Do not load a generative “preview splat” when reconstruction failed. Do not put Mapillary (or any street vendor) inside the indoor viewer. |

### HM-06 — Outdoor approach panos + MapLibre pin + door tether

| | |
|---|---|
| **Priority / deps** | P1 / HM-05, listing coordinates from HM-01 |
| **Scope** | Host-captured approach panoramas (or a short outdoor walk) plus a MapLibre pin at the listing. A door / threshold tether: leaving the indoor splat enters the approach pano; a control returns inside. Street View–**style** (Stead-hosted or Panoramax / PSV), not a Google Street View product dependency. |
| **File map (proposed)** | MapLibre on listing detail (and only where coordinates are public by policy). Approach pano assets on the scan prefix. |
| **Acceptance** | Pin, indoor splat, and approach pano are the same listing. Tether is explicit. Third-party outdoor imagery is labeled as such and never used to invent a façade when the host did not capture one. |
| **Hard stop** | Mapillary as the sole outdoor layer. Do not drape an invented building on the map. |

### HM-07 — Neighborhood walk + nearby Stead discovery

| | |
|---|---|
| **Priority / deps** | P1 / HM-06, public-safe coordinates |
| **Scope** | In a searched city, the guest walks real outdoor imagery (host approach panos and/or Panoramax / PSV). Nearby Stead homes appear from a **spatial query** over scan-verified listings, not from a generated city mesh. In-world affordance opens that listing’s indoor splat. |
| **File map (proposed)** | New read API (bbox / distance), RLS-safe public fields only, Explore or a dedicated walk mode. Indexes for the spatial query (Postgres earthdistance / `ll_to_earth` or a later `geography` column — choose in the migration, test it). |
| **Acceptance** | Empty city → honest empty walk, no fake houses. A pin is a real `listings` row that is scan-verified (and otherwise public). Another host’s draft does not appear. |
| **Hard stop** | No invented buildings, streets, or “typical block.” No seed-home walkthroughs on Production. |

### HM-08 — Require scan-verified before publish / bookable

| | |
|---|---|
| **Priority / deps** | P0 / HM-00; enforce once HM-04 can produce verified scans (feature-flag the requirement in staging if needed, **on** for Production Soft Dist before Nick flips bookings) |
| **Scope** | Server: transition to guest-visible `active` and create-booking both require a verified scan for that listing. Host UI: publish checklist includes “Honesty scan verified.” Keep `ALLOW_GUEST_BOOKINGS` exact-`1` fail-closed. Quote may remain read-only while the platform flag is off. |
| **File map (proposed)** | Listing publish path, `server/routes/bookings.ts` (or the existing create-booking guard next to `allowGuestBookings`), RLS / `SECURITY DEFINER` as needed, `tests/guest-bookings.test.ts` still proving the platform flag, **plus** new tests that a verified-scan miss refuses book / publish even when the flag is `1` in test. |
| **Acceptance** | These facts remain distinct: draft, published, payout-ready, scan-verified, and platform bookings-on. A listing can be a draft without a scan. It cannot be bookable without a scan. Production create-booking still refuses until Nick sets `ALLOW_GUEST_BOOKINGS=1`. Existing `tests/guest-bookings.test.ts` cases stay green. |
| **Hard stop** | Do not set `ALLOW_GUEST_BOOKINGS=1` in Production, CI defaults that leak to deploy docs, or `.env.example` as a Dist recommendation. Do not weaken the kill-switch to `"true"`. Do not make scan-verified imply payouts or the reverse. |

### HM-09 — QA + honesty badges + docs / runbook

| | |
|---|---|
| **Priority / deps** | P0 / HM-05, HM-08; full bar also HM-06, HM-07 |
| **Scope** | Honesty badge on listing card / detail / walkthrough. Vitest for geofence math, scan state transitions, and RLS probes. Browser coverage for: cannot publish without scan; viewer fallback; reduced motion; mask hides private rooms. Runbook: worker setup, SuperSplat crop-only, license pins, how to retry a job, how to revoke a scan. Update `docs/soft-launch.md` Nick-gates when the requirement is actually enforced in code (this docs PR only **points** at the plan). |
| **Acceptance** | Typecheck + tests green on the implementation PRs. Manual matrix notes indoor GPS failure, WebGL failure, and “bookings still off” on Production. Badge copy matches HM-00. |
| **Hard stop** | Do not mark Soft Dist “ready for bookings” in docs. That sentence stays Nick’s, after this phase ships and he flips the flag. |

---

## 9. MVP versus full Soft Dist launch bar

| Bar | Tickets | What is true |
|---|---|---|
| **MVP (honesty-media core)** | HM-00 … HM-05, HM-08, HM-09 (badge + scan QA) | A host can capture, geo-prove, reconstruct, mask, and show an indoor splat. Publish / bookable require `scan-verified`. Platform bookings remain off. |
| **Full Soft Dist product bar** | MVP + HM-06 + HM-07 + HM-09 runbook complete | Guests can walk the approach and the neighborhood, and discover nearby **real** Stead homes in-world. Still no live rental until Nick sets `ALLOW_GUEST_BOOKINGS=1`. |
| **Bookings on** | Full bar (or at least MVP + HM-08 live on Production) **and** Nick’s explicit Production env change | Not a ticket. Not this PR. PAY-02 remains held unless Nick opens that separately. |

The **launch criterion** Nick stated is the required geo-proven scan
before a home is bookable. Neighborhood walk is part of the Soft Dist
product, not a substitute for the scan gate.

---

## 10. Out of scope (this phase and this PR)

**This PR (docs only)**

- No application code, `drizzle/`, seed, or `.env` changes. Documentation
  references only.
- No change to `ALLOW_GUEST_BOOKINGS` semantics.
- No Visual Rails provisioning, accounts, or assigned tickets.

**Honesty-media implementation phase (later PRs)**

- PAY-02 (connected-account SetupIntent completion) — still held.
- Google OAuth, short stays, new payment processors, platform-MOR.
- Beautify / generative interiors / “complete this room.”
- Courtroom-grade location claims; mandatory Play Integrity / App
  Attest (optional later only).
- Mapillary-only outdoor stack; Google Street View SDK as a hard
  dependency.
- Invented city meshes, seed walkthroughs on Production, Santa Monica
  (or other strict-enforcement) demo inventory.
- Assigning reconstruction to Visual Rails (optional later; Nick’s
  call).
- Changing `bookings_min_stay` validation on Neon; `db:migrate` against
  Production without Nick.
- Edits under `/design`.
- Claiming bookings are open.

---

## 11. Risks

| Risk | Why it matters | Mitigation in this plan |
|---|---|---|
| **Indoor GPS accuracy** | Phone geolocation indoors is often a wide radius or a stale outdoor fix. A naïve geofence fails good hosts or passes a remote video. | Accuracy gate + require outdoor bookend samples (arrive / leave) or a confirmed outdoor approach capture (HM-06) before `verified`. Fail closed. Never invent a coordinate. |
| **EXIF spoofing** | Photo GPS is trivial to edit. | Continuous samples + server verdict; EXIF is supporting only. C2PA credentials if present; still not absolute proof. |
| **Reconstruction cost / time** | COLMAP + splatfacto is GPU-heavy and slow versus a photo upload. | Async worker; honest “processing” state; no request-path train. Visual Rails optional later — not a dependency. |
| **License drift** | A transitive NC or AGPL core would poison the hosted app. | Pin and re-read LICENSE in HM-03 / HM-09. Hard-avoid list in §5. |
| **WebGL / device limits** | Some guests cannot run a splat. | HM-05 fallback stills from captured frames (real frames, not generated). |
| **Privacy** | Scan includes private rooms and a location track. | HM-04 mask required; breadcrumbs not public; owner-only raw prefix. |
| **Empty Dist catalog** | No real hosts yet. | Do not fill the gap with invented walkthroughs. Empty is honest. |
| **Kill-switch regression** | A publish-gate ticket might “helpfully” enable bookings in preview and copy that to Production docs. | HM-08 / HM-09 keep `tests/guest-bookings.test.ts` and Production unset. |

---

## 12. Visual Rails (optional later — not assigned)

Visual Rails may become a place to run COLMAP + splatfacto if Nick
wants GPU workers off the Vercel request path. This plan:

- Does **not** create Visual Rails tickets, env vars, or deploy steps.
- Does **not** block HM-03 on Visual Rails access.
- Allows a future, separate PR to move the **same** worker image there.

Until then, the implementing agent documents a worker that can run where
the operator has a Linux/GPU host.

---

## 13. Definition of done (implementation phase)

This docs PR is done when the plan is reviewable and `docs/soft-launch.md`
points here. The **product** phase is done when:

- Every host-facing listing that can be bookable has a required
  geo-proven scan (HM-08 enforced on the server, not only in copy).
- Reconstruction path is the approved OSS stack (or a recorded,
  Nick-approved substitute from the same class), with SuperSplat limited
  to crop / compress.
- Guest indoor walk works on listing detail (HM-05) with honesty badges.
- Full Soft Dist bar: outdoor tether (HM-06) and neighborhood discovery
  of real nearby Stead homes (HM-07).
- Typecheck, domain tests, RLS probes, and agreed browser journeys pass
  on the implementation PRs.
- `ALLOW_GUEST_BOOKINGS` is still off on Production until Nick flips it.
- PAY-02 is still held unless Nick opens it.
- Copyright 2026 Stead contributors remains on the surfaces this phase
  touches.

Production launch of live rentals is an operator decision, not a merge.

---

## 14. License notes (research snapshot, 2026-09-14)

Verify at the commit you pin. This is not a substitute for reading the
files.

| Project | Typical SPDX / terms | Stead use |
|---|---|---|
| COLMAP | BSD-3-Clause | Pose core. |
| OpenMVG | Verify (often MPL-2.0) | Optional pose alt — confirm before pin. |
| Nerfstudio, gsplat, splatfacto | Apache-2.0 | Dense splat train. |
| SuperSplat | MIT (verify) | Crop / compress only. |
| Spark (`@sparkjsdev/spark`) | Verify LICENSE at pin | Indoor web viewer. |
| Three.js | MIT | WebGL renderer. |
| MapLibre GL JS | BSD-3-Clause | Neighborhood / pin. |
| Photo Sphere Viewer | MIT (verify) | Pano viewer. |
| Panoramax | Verify instance + client terms | Optional outdoor layer; not a reason to invent buildings. |
| c2pa-js | Apache-2.0 (verify) | Content credentials on the attestation package. |
| INRIA 3DGS, DUSt3R, MASt3R | Non-commercial | **Do not use.** |
| OpenMVS | AGPL-3.0 | **Do not use as hosted core.** |
| Luma APIs | Proprietary | **Do not use.** |

---

## 15. What this document is not

- Not a migration.
- Not a seed plan.
- Not permission to open guest bookings.
- Not a Visual Rails statement of work.
- Not a claim that indoor GPS is solved.

Next step after merge: a **new** implementation branch starting at
HM-00, one reviewable slice at a time.

Copyright 2026 Stead contributors.
