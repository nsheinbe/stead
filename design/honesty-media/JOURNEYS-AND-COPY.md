# Honesty media — journeys and copy

**Status:** Proposed design copy and behaviour for HM-00 through HM-09,
ready for review. Grounded in `main` at `1d6cc81` (this branch is one
documentation commit ahead of it). Nothing here claims a walkthrough,
scan, or worker exists on Production. Production inventory is empty by
design.

**Companions:** [screen inventory](SCREEN-INVENTORY.md) (per-screen
layout, states, permissions), [decisions and reconciliation](DECISIONS.md)
(what the current app already does, what each ticket must add, and every
open decision), [build plan](../../docs/honesty-media/BUILD-PLAN.md).

Precedence when two documents disagree: money / RLS / kill-switch /
honesty policy → BUILD-PLAN tickets → screen specs → this file → brief.

Copyright 2026 Stead contributors.

---

## 1. Locked strings (HM-00)

These are the strings HM-00 commits to the app as a copy module (for
example `src/lib/honestyCopy.ts` with a server mirror). Tests should
import them, not retype them. A change to a locked string is a copy
review, not a drive-by edit.

### 1.1 The badge

| Key | String | Where |
|---|---|---|
| `badge.short` | **Geo-proven walkthrough** | Listing cards, walk chrome on phone |
| `badge.full` | **Geo-proven walkthrough · Captured by the host · Stitched, not invented** | Listing detail, walk chrome on desktop, "About this walkthrough" sheet |
| `badge.ownerProcessing` | **Honesty scan in progress** | Host dashboard and editor only — never public |
| `badge.ownerMissing` | **No honesty scan yet** | Host dashboard and editor only — never public |

The badge is text with a small check mark drawn in the brand colour on
the accent surface. It is a **status label**, not a seal: no ribbon, no
shield, no serial number, no "verified by" line. It is not the Trust
Passport and never sits inside the Trust Passport card.

### 1.2 Guest disclosure

Shown in full on listing detail under the badge (collapsed behind
**About this walkthrough** on phone) and in the walk chrome's info
sheet. Every sentence is load-bearing; do not shorten it in the product.

> **About this walkthrough**
>
> The host filmed this walk on their phone, at this home. While they
> walked, their phone's location was checked against the home's location
> on Stead. Only the finished walkthrough is shown — never their route.
>
> The 3D view is stitched from what they filmed. We stabilise, crop and
> compress it. We never add rooms, furniture, windows or views that were
> not captured. If the footage was not enough, the host was asked to walk
> again.
>
> Location checks are a signal that the walk happened here. They are not
> proof against every trick, and they are not a legal record.

### 1.3 Captured on, and coverage

| Key | String | Notes |
|---|---|---|
| `capturedOn` | **Captured {date}** | `{date}` is the capture date in the listing's IANA zone, formatted `d MMM yyyy` via `formatInTimeZone`. Never "live", never "today". |
| `capturedOn.hint` | Dates follow this home's time zone. | Under the date on detail; omitted in the compact card |
| `coverage.whole` | **Whole home** — the walkthrough covers everything in the rental. | Requires the host's recorded whole-home confirmation |
| `coverage.partial` | **Rental area only** — the host left private rooms out. What you see is what you rent. | Requires a completed mask |

### 1.4 Nearby homes (HM-06 / HM-07)

| Key | String |
|---|---|
| `nearby.heading` | **Homes on Stead near here** |
| `nearby.explainer` | Every pin is a real home on Stead with a geo-proven walkthrough. Nothing on this map is generated. |
| `nearby.empty` | **No homes on Stead in {city} yet.** The first homes here will come from people who list them. |
| `imagery.host` | Approach filmed by the host. |
| `imagery.thirdParty` | Street imagery from {provider}. Not captured by the host, and not part of the honesty scan. |
| `imagery.none` | No street imagery here yet. We do not draw what nobody filmed. |

`{provider}` is the actual imagery source (for example "Panoramax"). It
is never a Google Street View product mark.

### 1.5 Host pre-capture sheet

The sheet a host must dismiss with **Start the walk** before the camera
opens. It is the HM-00 host disclosure from BUILD-PLAN §4, in product
voice. It shows every time a scan starts, not once per account.

> **Before you start the walk**
>
> **What we capture.** Video from your phone's camera, and your phone's
> location, checked continuously while you walk.
>
> **Why location.** To show guests this walk happened at this home. Guests
> never see your route — only the finished walkthrough.
>
> **What we do with the footage.** We stitch, stabilise, crop and
> compress it. We never invent rooms, furniture or views. If the footage
> is not enough, we will ask you to walk again rather than fill in the
> gaps.
>
> **Private rooms.** After processing, you mark what is private. Those
> parts are cut before anyone else can see the walkthrough.
>
> **Bookings.** Guests cannot book this home until a scan is verified.
> That is separate from payouts, and separate from Stead opening guest
> bookings.
>
> [Start the walk] [Not now]

### 1.6 Host scan states

One label and one next action per state. The label is the status; the
pill colour only reinforces it. No state uses the danger colour: a
failed scan is not a claim or a dispute.

| Scan state (server) | Label | Pill tone | Next action (one link) |
|---|---|---|---|
| none | Not started | neutral | **Scan this home** → capture |
| none, coordinates unconfirmed | Needs the home's location | warning | **Confirm the home's location** → editor "Where it is" |
| `capturing` | Capturing | neutral | **Continue the walk** → capture |
| `capturing`, upload begun | Uploading | neutral | **Finish uploading** → capture (upload step) |
| `uploaded` | Queued for processing | neutral | **Check progress** → status |
| `reconstructing` | Processing | neutral | **Check progress** → status |
| `needs_mask` | Needs private rooms marked | warning | **Mark private rooms** → mask |
| `verified` | Verified {date} | brand | **View the walkthrough** → walk |
| `rejected` | Couldn't confirm the location | warning | **Walk again** → capture |
| `failed` | Processing didn't finish | warning | **See what happened** → status |

`{date}` follows §1.3.

### 1.7 Location readout (capture)

Human units, no seal, no decimals. `{m}` is the reported accuracy radius
rounded to the nearest 5 m.

| Condition | Readout |
|---|---|
| Accuracy within the gate | **Location: good** (about {m} m) |
| Accuracy outside the gate | **Location: rough** (about {m} m). Step outside or near a window for a better fix. |
| No fix yet | **Location: waiting for your phone** |
| Permission denied | **Location: off.** Allow location for this site to continue. |
| Fix is inside the geofence | (no extra text — the readout is about accuracy, not the verdict) |

The browser never says "at this home" or "verified". Whether the samples
match the listing is the server's verdict after upload.

### 1.8 Refusals and errors

Exact server messages that the UI shows verbatim (mapped API errors are
the one case where the UI may show server text).

| Situation | HTTP | Message |
|---|---|---|
| Platform bookings off (existing, unchanged) | 403 | Bookings aren't open yet. |
| Booking a home whose scan is not verified (HM-08 defensive) | 409 | This home isn't open for booking yet. Its honesty scan hasn't been verified. |
| Publishing a home whose scan is not verified (HM-08) | 409 | This home needs a verified honesty scan before it can be published. |
| Starting a scan before coordinates are confirmed | 409 | Confirm where the home is before you scan it. |
| Upload package incomplete at completion | 409 | Some of the walk didn't finish uploading. Finish uploading, then try again. |
| Geofence verdict: too few accurate samples | (state `rejected`, reason shown on status) | We didn't get enough accurate location readings during the walk. Start and finish outside so your phone can get a clear fix. |
| Geofence verdict: samples cluster away from the home | (state `rejected`) | The location readings don't match where this home is on Stead. Check the home's location in the editor, then walk again. |
| Reconstruction failed | (state `failed`) | We couldn't build a walkthrough from this footage. This usually means the walk was too fast, too dark, or didn't overlap enough between rooms. |
| Storage not configured | 503 | Scans aren't configured on this deployment. |
| WebGL unavailable (browser) | — | This walkthrough needs a newer browser. Here are stills from the host's walk. |

The existing browser copy `BOOKINGS_CLOSED_COPY` ("Not open for bookings
yet" / "Guest stays aren't live yet. You can still read the home and
message the host.") stays byte-for-byte. `tests/guest-bookings.test.ts`
matches on it. The scan refusal uses different words on purpose so the
two facts stay distinguishable in tests and in support.

### 1.9 Buttons and verbs

Buttons say what they do. The verb list below is the allowed set for
honesty-media surfaces; anything not listed needs a copy review.

Allowed: Start the walk · Pause · Resume · Finish the walk · Walk again ·
Finish uploading · Check progress · Check again · Mark private rooms ·
Keep this area · Mark as private · Confirm whole home · Send for
verification · View the walkthrough · Walk through this home · Enter the
home · Leave the walkthrough · Step outside · Go inside · Walk {city} ·
Show the 3D walkthrough · Show stills instead · About this walkthrough ·
Confirm the home's location · Use my location here · Scan this home ·
Publish this home · Try again.

**Banned controls and verbs** (any surface, any state, including
"disabled for later"): Enhance · Beautify · Improve · Tidy · Clean up
this room · Complete the room · Fill in · Auto-fix · Magic · Preview
while we wait · AI-generated preview · Live · Verified by GPS ·
Tamper-proof · Court-grade. Plus the platform ban list: blockchain,
crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.

"Cleanup" is allowed as a description of what the worker does
(BUILD-PLAN §4) but is never a button, because a button called Clean up
invites the reading "make it nicer".

---

## 2. Journey H1 — host, first scan

Entry points: **Scan this home** on the host dashboard row
([HM-D13](screens/HM-D13.md)), the editor's publish checklist
([HM-D10](screens/HM-D10.md)), or the direct URL
`/host/listings/:listingId/scan`. Phone-first: the capture step refuses
to open the camera on a device without one and instead shows the URL to
open on a phone.

| Stage | Host's question | Interface and next action | Server truth |
|---|---|---|---|
| Dashboard | Which home needs what? | Row shows "Not started" and **Scan this home** | Scan state per listing on the owner DTO ([HM-D13](screens/HM-D13.md)) |
| Location | Where does Stead think my home is? | Editor "Where it is" gains coordinates and **Confirm the home's location** with "this is the front door" language. Options: **Use my location here** (standing at the door) or typed coordinates. Confirmation is a recorded action. | `listings.lat` / `lng` (already accepted by `PATCH /api/listings/:id`) plus a new `coordinates_confirmed_at`. A scan cannot start without it ([HM-D02](screens/HM-D02.md)) |
| Before the walk | What are you going to do with this? | Pre-capture sheet (§1.5). **Start the walk** asks for camera and location permission, in that order, each with a one-line reason | No server call yet |
| Outside first | Why start outside? | Viewfinder with the location readout (§1.7). Copy: "Start outside the front door so your phone gets a clear fix, then walk in." **Finish the walk** stays disabled until the outdoor bookend is met and at least one indoor minute has been recorded | Bookend rule is server config; the browser only shows progress toward it ([HM-D01](screens/HM-D01.md)) |
| The walk | Am I doing this right? | Live guidance: elapsed time, "slow and steady", "turn at each doorway", "film every room you rent". **Pause** / **Resume**. Screen stays awake where the browser allows it | Samples accumulate on the device with the recording clock |
| Outside last | Are we done? | "Finish outside the front door, then tap Finish the walk." Readout must be good again | — |
| Upload | Is it safe to leave this page? | Progress per part: video, location record, camera notes. "Keep this page open until the upload finishes." Interrupted → **Finish uploading** resumes | Presigned upload to the scan prefix; completion call validates the package is whole ([HM-D03](screens/HM-D03.md)) |
| Receipt | Did it work? | "Uploaded. We're checking the location record now." then either "Location confirmed — queued for processing" or a `rejected` reason (§1.8) | Geofence verdict is computed on the server from the uploaded samples, never taken from the browser |
| Processing | How long? | Status page: "Processing. This can take a while — often hours. We'll email you when it's done." **Check again**. No fake ETA | Worker sets `reconstructing` → `needs_mask` / `failed` ([HM-D04](screens/HM-D04.md)) |
| Private rooms | Who sees my bedroom? | Mask page: mark private moments of the walk and/or confirm whole home. **Send for verification** | Mask persisted; worker applies crop; server sets `verified` ([HM-D05](screens/HM-D05.md)) |
| Verified | Now what? | "Verified {date}." **View the walkthrough** · **Publish this home** (if draft) | `verified` with `scan_verified_at` on the listing |

### Branches

**Camera or location permission denied.** Explain what each permission is
for and how to re-enable it in the browser; offer **Try again**. Nothing
records without both. Never fall back to "we'll trust you" — a scan
without location samples cannot be verified.

**Location rough for the whole walk (indoor GPS).** The readout says so
in real time. If the outdoor bookends were good, the walk can still be
finished: the server judges the bookends plus the indoor drift. If the
bookends were never good, **Finish the walk** stays disabled with the
reason: "We need a clear location fix outside the door at the start and
the end." No invented coordinate, no "use your last known location"
shortcut.

**Geofence fail after upload.** State `rejected`, reason from §1.8. The
status page offers **Walk again** and, when the reason is a mismatch,
**Check the home's location** (editor). The host's raw upload stays
owner-only and is not processed.

**Upload interrupted.** State stays `capturing` with parts recorded. The
dashboard row reads "Uploading" with **Finish uploading**. Parts already
stored are not re-sent. If the device lost the recording, the only
honest path is **Walk again**.

**Reconstruction failed.** State `failed`, reason from §1.8. The status
page shows stills from the captured frames (real frames only) so the
host can see what the worker saw, plus **Walk again** and **Try
processing again** (idempotent retry; the same footage). No preview
splat, no generated stand-in.

**Left the mask page.** State stays `needs_mask`; dashboard row reads
"Needs private rooms marked". Nothing is public.

---

## 3. Journey H2 — host, publish blocked

A complete draft with photos, a description and payouts set up still
cannot publish without a verified scan once HM-08 ships.

| Stage | Host's question | Interface | Server truth |
|---|---|---|---|
| Review step | Why can't I publish? | Checklist ([HM-D10](screens/HM-D10.md)): Photos ✓ · Description ✓ · **Honesty scan — Not started. Guests can't book without it.** → **Scan this home** · Payouts — separate row, unchanged. **Publish this home** is disabled with that reason adjacent | Publish is refused server-side with the §1.8 message even if the button is enabled by a stale page |
| Dashboard | Can I just publish from the list? | Row button **Publish this home** is replaced by the scan's next action while the scan is not verified | Same server refusal |
| After verification | Now? | Checklist row becomes "Honesty scan — Verified {date}". **Publish this home** enabled | `scan_verified_at` set |
| Published | Can guests book? | Success copy (revised): "Your home is published. Guests can find it and read the walkthrough. Booking opens when Stead turns on guest bookings — that's separate from your listing." | Platform kill-switch unchanged; `guestBookingsOpen` false on Production |

The three host-facing facts stay three rows: **Published** (listing
status), **Honesty scan** (server verdict), **Payouts** (Stripe). None of
them implies another, and none of them implies Stead's platform switch.

---

## 4. Journey G1 — guest, listing walk

| Stage | Guest's question | Interface | Server truth |
|---|---|---|---|
| Card | Can I actually see this place? | Badge short form on the card when verified; nothing when not ([HM-D12](screens/HM-D12.md)) | `honesty` on the public summary DTO, server-derived |
| Detail | What am I looking at? | Under the gallery: badge full form · Captured {date} · coverage line · **About this walkthrough** (disclosure §1.2) · poster still (a real captured frame) with **Walk through this home** | `GET /api/listings/:id` includes `honesty` only for verified, active listings |
| Walk | How do I move? | `/listing/:id/walk`, full viewport, focused shell. First-run overlay: "Look around: drag, or arrow keys · Move: on-screen arrows, or W A S D · Leave: Esc or the Back button". Badge stays in the chrome. **About this walkthrough** opens the disclosure sheet | Artifact via a short-lived signed URL from the walkthrough endpoint; 404 for anything not verified and active unless the owner is asking ([HM-D06/D07](screens/HM-D06-D07.md)) |
| Reduced motion | I don't want a moving camera | Default view is the stills grid from the captured frames with **Show the 3D walkthrough** as an opt-in; the 3D view never autoplays a camera move | Stills are worker-selected real frames |
| No WebGL | Why is it blank? | Stills grid plus "This walkthrough needs a newer browser. Here are stills from the host's walk." Nothing else | — |
| Outside (HM-06) | What's the street like? | **Step outside** at the door: the host's approach footage, labelled "Approach filmed by the host". **Go inside** returns to the same door | Approach artifact is on the same scan; the tether is explicit ([HM-D08](screens/HM-D08.md)) |
| Book | Can I book it? | Unchanged while the platform switch is off: **Not open for bookings yet** panel. When on: **Choose dates** → checkout; the server still refuses a non-verified listing with the §1.8 message ([HM-D11](screens/HM-D11.md)) | Two independent gates |

Owner preview: the owner can open `/listing/:id/walk` for their own
draft or paused home and sees the existing "You're previewing your draft
listing" banner in the chrome. Nobody else can.

---

## 5. Journey G2 — guest, neighbourhood walk (HM-07)

| Stage | Guest's question | Interface | Server truth |
|---|---|---|---|
| Explore | What's this city like? | When a city filter is set and at least one result has a verified walkthrough, the filter bar offers **Walk {city}** → `/walk?city=…` ([HM-D09](screens/HM-D09.md)) | Same listing query; the link is derived from results already on screen |
| Walk mode | Where am I? | Desktop: map with the city's Stead pins beside the street view; phone: street view with the map in a sheet. Heading "Homes on Stead near here" and the explainer (§1.4) | Pins from a new spatial read over verified, active, non-seed listings, public-safe fields only |
| A pin | What is that? | Card: title, place, 30-night estimate, badge short form, **Walk through this home** → G1 walk. Pins are rounded to the precision the host allowed ([HM-D08](screens/HM-D08.md)) | Row must be a real `listings` row that passes the public policy |
| No imagery | Why is it grey? | "No street imagery here yet. We do not draw what nobody filmed." Map and pins still work | — |
| Empty city | Where is everyone? | "No homes on Stead in {city} yet." plus the two existing host actions, **List your home** and **Start your listing** | Same `CatalogEmptyActions` as Explore |

A city with third-party imagery but no Stead homes is still an empty
city: imagery is context, not inventory.

---

## 6. Journey H3 — re-mask, re-verify, revoke

- **Re-mask.** The host edits the mask on a verified scan. The live
  walkthrough stays live and unchanged. The new mask goes through
  `needs_mask` → verification again; only on `verified` does the served
  artifact swap. Copy on the mask page: "Your current walkthrough stays
  up until the new one is verified."
- **Walk again on a verified home.** Same rule: a new scan is a new row;
  the listing points at the old verified scan until the new one
  verifies.
- **Revoke (ops, HM-09 runbook).** Revoking a scan clears the listing's
  verification and takes the listing off the market (`paused`) in the
  same transaction, so an active listing always has a verified scan. The
  host is emailed: "We've taken {title} off the market because its
  honesty scan was withdrawn. Walk again to publish it." Guests never see
  a revoked walkthrough.

---

## 7. Copy checklist for every honesty-media PR

- [ ] Strings come from the locked module, not retyped.
- [ ] No banned verb or control (§1.9), including disabled ones.
- [ ] "Captured {date}" uses the listing time zone; never "live".
- [ ] The badge never claims proof, GPS certainty, or a legal record.
- [ ] Failure states use ink and warning tones, never the claim red.
- [ ] `BOOKINGS_CLOSED_COPY` and `GUEST_BOOKINGS_CLOSED_MESSAGE` unchanged.
- [ ] Third-party imagery is labelled with its source and never used to
      stand in for a façade the host did not film.
- [ ] Empty is empty: no seed walkthroughs, no invented pins.
- [ ] Copyright 2026 Stead contributors on new surfaces.

Copyright 2026 Stead contributors.
