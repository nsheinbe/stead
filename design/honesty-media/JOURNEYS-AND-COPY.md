# Honesty media — journeys and copy

**Status:** Specified design copy and journeys for HM-00 … HM-09. Written on
the honesty-media handoff branch as the HM-00 design fill. Not shipped UI. Not
a claim that any walkthrough exists on Production.

**Read with:** [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) (frame, visual rules),
[`SCREEN-INVENTORY.md`](SCREEN-INVENTORY.md) (per-screen layout, states,
a11y, hard stops), [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md)
(tickets, §4 honesty policy, §6 invariants).

**Precedence when anything here conflicts:** money / RLS / kill-switch /
honesty policy → BUILD-PLAN tickets → `SCREEN-INVENTORY.md` → this file →
`DESIGN_BRIEF.md`.

Every string in §9 has an id (`hm.*`). Implementation mirrors them into one
copy module (HM-00 proposes `src/lib/honesty.ts`; the name is the ticket's)
so a reviewer can diff copy against this file. Strings are final unless Nick
changes them here first.

Copyright 2026 Stead contributors.

---

## 1. Vocabulary

| Say | Not | Where |
|---|---|---|
| **Honesty scan** | verification scan, proof scan, 3D capture | Host surfaces: the feature a host completes |
| **Walk** (the recording) | video, footage, session | Host capture and upload copy |
| **Walkthrough** | tour, 3D model, splat, scene, render | Guest surfaces and the host review step |
| **Geo-proven** | GPS-verified, location-certified, authenticated | The badge and its long form only |
| **Front door pin** | coordinates, lat/lng, geofence | Host coordinate step. “Coordinates” appears only inside the advanced disclosure |
| **Private areas** | masked regions, exclusions, crop volume | Host mask step |
| **Rental areas** | the unit, the listing volume | Host mask step and the guest scope line |
| **Stitched, steadied, compressed** | processed, enhanced, optimized, cleaned up, AI-assisted | Every disclosure. “Cleaned up” is banned because it implies tidying |
| **Approach** | street view, exterior tour | The outdoor pano at the door (HM-06) |
| **Neighborhood walk** | city explorer, metaverse, virtual city | HM-07 route |

“Host” is the person a guest reads about; “homeowner” stays acquisition
language on `/for-homeowners`. “Guest” is the person walking.

Never in product copy: blockchain, crypto, wallet, web3, DAO, smart contract,
on-chain, gas, and the honesty-specific bans in §10.

---

## 2. Journey H1 — host, first honesty scan

Entry: `/host/listings/:listingId` (editor) or the row on `/host/listings`.
The whole journey is phone-first from the capture step onward; the pin step
and the mask step also work on desktop.

| Stage | Host’s question | Screen and primary action | Server fact required before the screen can say so |
|---|---|---|---|
| Editor, “Where it is” | Where exactly is the home? | Front door pin card (HM-D02). **Set the front door pin** on a map, or **Use my location now** while standing at the door. Choose what guests see: neighborhood (default) or exact spot. | `listings.lat/lng` written by the owner PATCH. The page shows “Pin set” only after the PATCH returns. |
| Scan hub | What do I do, and where? | `/host/listings/:listingId/scan` (HM-D01 hub). State: Not started. **Scan from your phone**. On desktop this is a hand-off panel, not a camera. | Listing is the caller’s. Pin exists — otherwise the hub shows “Set the front door pin first” and one link. |
| Before you start | What are you recording, and why? | Pre-capture sheet (HM-D00, §8.1). Checkbox **I’ve read this and I’m at the home now** → **Start the walk**. | Server returns the current honesty policy version; the acknowledgment is recorded with the scan when the capture session is created. |
| Permissions | Will this work? | Camera + location prompts, in that order. Denied → §9.3 copy, **Try again**. No path continues without both. | None. Client fact only, and it never becomes a verdict. |
| Outdoor start | Am I in the right place? | Viewfinder shows the location line (§9.3). Prompt: “Outside your front door? Turn slowly in a full circle.” **I’m outside — start** enables only on a good fix. | Nothing yet. The accuracy threshold (integer meters) came from the server with the capture session. |
| Indoor walk | Is it still working indoors? | Recording. Location line says “rough — expected indoors”. **Pause** / **Finish outside**. Screen stays awake. | None. Samples keep streaming to the local record. |
| Outdoor finish | How do I end it properly? | Prompt: “Back outside your front door? Turn slowly in a full circle, then finish.” **Finish the walk** enables only on a good fix. **Stop without finishing** deletes the walk after a confirmation. | None. |
| Upload | Did it save? | `/scan` hub in Uploading state (HM-D03). Progress by group. **Pause upload** / **Resume upload**. “Keep this page open.” | Presigned URLs per object from the server; the hub says “Uploaded” only after the server records the complete package. |
| Location check | Was it really here? | Hub: “Checking the location record.” Then “Location confirmed at this home” or a Not-verified reason (§9.5) with **Check the pin** / **Scan again**. | Server computed the geofence verdict from the samples. The browser never displays a verdict it computed itself. |
| Building | How long? | Hub: In the queue → Building the walkthrough (HM-D04). “This can take a while.” No ETA unless the worker reports one. | `listing_scans.state` from the worker. |
| Couldn’t build | What went wrong, and what do I do? | Hub: Couldn’t build (§9.6) with the reason, stills from the recorded frames, **Scan again** or **Retry** (transient worker error only). | Worker wrote `failed` with an enumerated reason. |
| Mark private areas | What will guests see? | `/host/listings/:listingId/scan/mask` (HM-D05). Draw private boxes, or **Confirm whole home** when the listing type allows it. **Preview as a guest**. **Finish and verify**. | Splat exists. Listing type decides whether whole-home confirm is offered. |
| Verified | Is it done? | Hub: Verified. **See it as a guest** → `/listing/:id/walk`. Publish checklist row turns to “Verified”. | Worker applied the crop and set `verified`. |

### GPS-poor branch

Indoors the location line is expected to read “rough”. That is not an error,
and the copy says so. The gate is the two outdoor bookends: the walk cannot
start or finish without a good fix outside, and the server refuses to verify a
walk without both. Nothing in this branch invents a coordinate, uses the
network address, or reads EXIF as proof.

If the outdoor fix never gets good: the button stays disabled with “Waiting
for a clearer location fix… Standing still helps.” After the configured wait
the sheet offers **Stop without finishing** only. There is no “skip the
check” control.

### Geofence-fail branch

Upload completes, the server says not verified. The most common cause is a
wrong pin, so the first action is **Check the pin**, the second **Scan
again**. The state is calm ink on surface — not danger red, not claim red.
Nothing was charged, nothing is public, nothing is lost except time.

---

## 3. Journey H2 — host, publish blocked

| Stage | Host’s question | Screen and action | Server fact |
|---|---|---|---|
| Review step (wizard) or editor | Can I publish? | Checklist (HM-D10): Details, Photos, Honesty scan, Payouts. **Publish this home** is disabled until the scan row reads Verified. Reason text under the button. | `scan_verified_at` (or equivalent) on the listing. Publish is refused server-side regardless of the button (HM-08). |
| Homes list | Which home needs what? | Row pill “Scan: Not started” etc. (HM-D13) with exactly one next action. | Same fact, per row, owner-only. |
| Payouts | Is that the same thing? | Payouts row says “separate — needed before a guest can pay, not before publishing.” | Connect readiness, from Stripe via the server. |
| Platform gate | Why still “Not open for bookings yet”? | Info line: “Guest bookings on Stead aren’t open yet.” Shown while `guestBookingsOpen` is false. | `PublicConfig.guestBookingsOpen`, which is `ALLOW_GUEST_BOOKINGS === "1"` and nothing else. |

Four facts, four rows, never one badge: draft/published, scan-verified,
payout-ready, platform bookings on.

---

## 4. Journey H3 — host, change or take down a walkthrough

- **Change the mask** after verification: warning dialog (§9.7). Confirming
  moves the scan back through crop + verification. While that runs the
  guest walk is unavailable and the home is not bookable. Privacy wins over
  continuity; the alternative (keep the old walkthrough live until the new
  one verifies) is listed as an open decision in the brief.
- **Scan again** after verification: same warning; the new walk replaces
  the old one only when it verifies. Until then the old one stays live
  (nothing new is hidden by a re-scan, so continuity wins here).
- **Taken down** (`revoked`, ops or host): the hub shows why in one
  sentence and the one action **Scan again**. Guests see no badge and no
  walk CTA; post-HM-08 the home is not bookable.

---

## 5. Journey G1 — guest, walk a home

| Stage | Guest’s question | Screen and action | Server fact |
|---|---|---|---|
| Explore card | Is this home real? | Compact badge “Geo-proven walkthrough” on the card (HM-D12). No badge on homes without one. | Public listing DTO carries `walkthrough` only for active + verified. |
| Home detail | How was this made? | “Walk through this home” section (HM-D06): full badge, captured date, scope line, host-recorded stills, **Walk through this home**, and a **How this walkthrough was made** disclosure. | Same DTO. Stills are real frames. |
| Enter | Can my device do this? | `/listing/:id/walk` (HM-D07). Loading with real byte progress. WebGL missing → stills mode. `prefers-reduced-motion` → stills mode by default with **Start the 3D walk** opt-in. | Short-lived signed artifact URL from the server; nothing fetchable by id guessing. |
| Walk | How do I move? | Move / look / **Leave the walk** (Esc). **How to move** overlay. Badge and disclosure stay one tap away. | None. |
| Go outside | What’s the street like? | **Go outside** at the door → the host’s approach pano (HM-D08). **Go inside** returns. Map with pin or neighborhood area, per the host’s choice. | Approach pano exists for every verified scan (it is the outdoor start bookend). Map precision is the host’s recorded choice. |
| Book | Can I stay here? | Unchanged: “Not open for bookings yet” while the platform flag is off (HM-D11). After Nick flips it, a home whose walkthrough was taken down refuses with a guest-safe reason. | `guestBookingsOpen`; then the HM-08 server check. |

Recovery: load failure → **Try again** and the stills; a draft or unverified
home → the walk route is a 404 (“No walkthrough here.”) for anyone but its
owner; owner previewing an unfinished scan → “Your walkthrough isn’t ready
yet” with a link to the hub.

---

## 6. Journey G2 — guest, neighborhood walk

| Stage | Guest’s question | Screen and action | Server fact |
|---|---|---|---|
| Explore with a city | What’s the area like? | Link **Walk {city}** under the results heading when a city filter is set. | None; the link is always honest because the walk page is. |
| Walk page | Where are the homes? | `/walk?city={city}` (HM-D09). Desktop: map + street imagery side by side. Phone: street imagery with a Map sheet. Pins are geo-proven Stead homes only. | Spatial read over active + verified listings, public-safe positions, server-side. |
| Empty city | Is something broken? | “No geo-proven homes in {city} yet.” with the host-led actions from the empty catalog. Map still renders. No houses, no “typical block”. | Zero rows. |
| Street imagery | Is this the host’s? | Host approach panos at pins. Between pins, labeled third-party imagery only where the deployment has it configured; otherwise “No street imagery here yet” and the map alone. | Imagery source per frame, from the server. |
| Nearby | Which homes are close to here? | List “Homes on Stead near this view” with compact cards; a pin or card opens HM-D06/D07. | Same spatial read, re-queried as the view moves. |

---

## 7. Facts the UI never collapses

| Fact | Set by | Guest-visible when | Host-visible where |
|---|---|---|---|
| Draft / published / paused | Host, via existing PATCH | Catalog rules unchanged | Status pill (existing) |
| Scan verified | Server / worker after geofence + crop | Badge and walk CTA on active homes | Hub state, checklist row, homes-list pill |
| Payout-ready | Stripe, read by the server | Never | Payouts page and checklist row |
| Platform bookings open | Nick, `ALLOW_GUEST_BOOKINGS=1` on Vercel Production | Book / Reserve enabled | Info line on the checklist |

A verified scan does not open bookings. Publishing does not verify a scan.
Payouts are separate from both. Stays remain ≥ 30 nights. The host remains
merchant of record.

---

## 8. Disclosures (verbatim)

### 8.1 Host, before the first frame (`hm.sheet.*`)

Shown as a full-height sheet on the phone and a centered dialog on desktop
before the capture session is created. All sections visible without
expanding; tips may sit below the fold.

**Before you start the walk**

**What we record**
- Video from your phone’s camera while you walk.
- Your phone’s location, continuously, while you record.

**Why the location**
To prove this walk happened at this home. Guests see that it was proven, and
the date. They never see your route.

**What we do with the video**
We stitch, steady, and compress it into a walkthrough guests can move through.
We don’t add rooms, furniture, or views, and we don’t tidy anything up. What
you record is what guests see.

**Private areas**
After the walk, you mark anything private. It’s cut out before anyone else
sees the walkthrough.

**Bookings**
A home can’t take bookings until its walkthrough is verified.

**Tips**
Start outside your front door and turn slowly in a full circle. Walk every
room you want guests to see, slowly, with the lights on. Finish outside your
front door the same way.

☐ I’ve read this and I’m at the home now.

[ Start the walk ]  [ Not now ]

### 8.2 Guest, on every walkthrough (`hm.about.*`)

Reachable from the detail section and from the walk chrome as “How this
walkthrough was made”. Plain text, no seal graphic.

**How this walkthrough was made**

The host recorded this walk on their phone, at this home. Their phone
reported its location the whole time, within {radius} m of the listing’s
front door pin, and the walk started and ended outside the front door.

We stitched, steadied, and compressed what they recorded. We didn’t add
rooms, furniture, or views. If something wasn’t recorded, it isn’t here.

{scope} — one of:
- *Whole home.* Everything you can walk is part of the rental.
- *Rental areas only.* Private rooms are left out on purpose.

Captured {date}. This is a record of that day, not a live feed.

Nearby pins are other Stead homes with a geo-proven walkthrough. Nothing on
the map is made up. *(neighborhood walk and approach only)*

Location proof is a strong signal, not a guarantee.

---

## 9. Copy system

Ids are stable. `{…}` are values the server supplies. Dates are
listing-local calendar dates with no time. Meters are integers.

### 9.1 Badge (locked by HM-00)

| Id | Copy | Rule |
|---|---|---|
| `hm.badge.short` | Geo-proven walkthrough | Card pill and walk chrome. Always with the mark glyph and never alone as an icon. |
| `hm.badge.full` | Geo-proven walkthrough · Captured by the host · Stitched, not invented | Detail section and the top of the disclosure. |
| `hm.badge.captured` | Captured {date} | Listing-local date. Never “live”, never a relative “3 days ago”. |
| `hm.badge.scope.whole` | Whole home | Only when the host recorded a whole-home confirmation. |
| `hm.badge.scope.partial` | Rental areas only | Only when a private mask or keep-box exists. |
| `hm.badge.a11y` | Geo-proven walkthrough. Captured by the host on {date}. Stitched from what the host recorded, not invented. | `aria-label` for the compact treatment. |
| `hm.badge.processing` | Walkthrough in progress | Host-only. Never rendered for guests. |
| `hm.badge.none` | No walkthrough yet | Host-only. Guests see nothing at all. |

### 9.2 Front door pin (HM-D02)

| Id | Copy |
|---|---|
| `hm.pin.title` | Where the front door is |
| `hm.pin.hint` | Drop the pin on your front door. Your honesty scan is checked against this spot. |
| `hm.pin.set` | Set the front door pin |
| `hm.pin.move` | Move the pin |
| `hm.pin.useLocation` | Use my location now |
| `hm.pin.useLocation.hint` | Stand at your front door with your phone. We use your phone’s location, never your network. |
| `hm.pin.confirm.title` | Is this your front door? |
| `hm.pin.confirm.accuracy` | Your phone puts you within about {accuracy} m of here. |
| `hm.pin.confirm.yes` | Yes, set it here |
| `hm.pin.confirm.no` | No, let me move it |
| `hm.pin.saved` | Pin set. |
| `hm.pin.noFix` | We couldn’t get a location fix. Try again outside, or drop the pin by hand. |
| `hm.pin.advanced` | Enter coordinates |
| `hm.pin.advanced.hint` | Decimal degrees, such as 40.7128, -74.0060. |
| `hm.pin.precision.legend` | What guests see on the map |
| `hm.pin.precision.area` | The neighborhood — an area about {area} m across, not the exact spot |
| `hm.pin.precision.exact` | The exact spot |
| `hm.pin.precision.note` | Guests with a confirmed stay always see the exact spot. |
| `hm.pin.required` | Set the front door pin first. Your honesty scan is checked against it. |
| `hm.pin.lat` | Latitude |
| `hm.pin.lng` | Longitude |
| `hm.pin.invalid` | Enter both latitude and longitude as decimal degrees, or leave both empty. |
| `hm.pin.roughFix` | That fix is too rough to use (about {accuracy} m). Try again outside, standing still, or enter the coordinates by hand. |
| `hm.pin.unsaved` | Save changes to set the pin. |
| `hm.pin.changeWarning` | Changing the pin takes down any honesty scan for this home. You’d scan again. |

### 9.3 Capture (HM-D01)

| Id | Copy |
|---|---|
| `hm.hub.title` | Honesty scan |
| `hm.hub.notStarted.title` | Not started |
| `hm.hub.notStarted.body` | Walk-scan your home from your phone while you’re there. It takes one visit. |
| `hm.hub.start` | Scan from your phone |
| `hm.hub.desktop.title` | Scan from your phone |
| `hm.hub.desktop.body` | Recording needs your phone’s camera and location. Sign in on your phone, open Your homes, choose this home, then Scan. |
| `hm.hub.desktop.email` | Email me the link |
| `hm.hub.desktop.emailed` | Sent to {email}. |
| `hm.hub.inProgress.title` | Walk in progress |
| `hm.hub.inProgress.body` | A walk was started on your phone and hasn’t been finished. Continue it there, or delete it and start again. |
| `hm.hub.discard` | Delete this walk |
| `hm.hub.located.title` | Location confirmed at this home. |
| `hm.hub.located.body` | Uploading the walk itself is the next step and isn’t switched on yet. Your recording is kept on this phone, in this browser, until then. |
| `hm.hub.facts` | Verified isn’t published, isn’t payouts, and isn’t bookings open. Each is its own step. |
| `hm.editor.scan.title` | Honesty scan |
| `hm.editor.scan.body` | Before guests can book, walk-scan the home from your phone. The walk is checked against the front door pin. |
| `hm.editor.scan.cta` | Open the honesty scan |
| `hm.capture.unsupported` | This browser can’t record in the page. Open this link in Safari or Chrome on your phone. |
| `hm.perm.camera.title` | Stead needs the camera to record the walk. |
| `hm.perm.camera.body` | Allow camera access in your browser settings, then try again. |
| `hm.perm.location.title` | Stead needs your location while you record. |
| `hm.perm.location.body` | It’s how we prove the walk happened at this home. Allow location access, then try again. |
| `hm.perm.retry` | Try again |
| `hm.loc.good` | Location: good (about {accuracy} m) |
| `hm.loc.rough` | Location: rough (about {accuracy} m) — expected indoors |
| `hm.loc.none` | Location: no fix yet — step outside |
| `hm.loc.off` | Location: off — allow location to continue |
| `hm.capture.outsideStart.prompt` | Outside your front door? Turn slowly in a full circle. |
| `hm.capture.outsideStart.cta` | I’m outside — start |
| `hm.capture.turn.prompt` | Recording. Turn slowly in a full circle at your door, then walk in. |
| `hm.capture.walkIn` | Walk in |
| `hm.capture.waitingFix` | Waiting for a clearer location fix… Standing still helps. |
| `hm.capture.recording.prompt` | Walk every room slowly. Lights on. Take your time. |
| `hm.capture.pause` | Pause |
| `hm.capture.resume` | Resume |
| `hm.capture.paused` | Paused. Your location is still being recorded. |
| `hm.capture.background` | Recording paused when the app went to the background. Continue where you were. |
| `hm.capture.finishOutside` | Finish outside |
| `hm.capture.outsideEnd.prompt` | Back outside your front door? Turn slowly in a full circle, then finish. |
| `hm.capture.outsideEnd.cta` | Finish the walk |
| `hm.capture.stop` | Stop without finishing |
| `hm.capture.stop.title` | Delete this walk? |
| `hm.capture.stop.body` | A walk that doesn’t end outside can’t be verified. Nothing has been uploaded yet. |
| `hm.capture.stop.confirm` | Delete this walk |
| `hm.capture.stop.cancel` | Keep waiting |
| `hm.capture.awake` | Recording keeps the screen on. Plug in if you can. |
| `hm.capture.maxLength` | Walks up to {maxMinutes} minutes. |
| `hm.capture.elapsed` | {mm}:{ss} |
| `hm.capture.preparing` | Getting the camera ready… |
| `hm.capture.maxReached` | You’ve reached the {maxMinutes}-minute limit. Head back outside and finish the walk. |
| `hm.capture.submitting` | Sending the location record… |
| `hm.capture.submitFailed` | We couldn’t send the location record. Try again when you’re back online. |
| `hm.capture.interrupted.title` | This walk was interrupted. |
| `hm.capture.interrupted.body` | The recording didn’t survive the reload. Delete this walk and start again from the door. |
| `hm.capture.notCurrent` | This walk isn’t open any more. |

### 9.4 Upload (HM-D03)

| Id | Copy |
|---|---|
| `hm.upload.title` | Uploading your walk |
| `hm.upload.body` | Keep this page open. Wi-Fi is best. |
| `hm.upload.progress` | {done} of {total} uploaded |
| `hm.upload.group.video` | Video |
| `hm.upload.group.location` | Location record |
| `hm.upload.group.details` | Details |
| `hm.upload.pause` | Pause upload |
| `hm.upload.resume` | Resume upload |
| `hm.upload.stopped.title` | The upload stopped. |
| `hm.upload.stopped.body` | Nothing you recorded was lost. Resume when you’re back online. |
| `hm.upload.tooLarge.title` | This walk is larger than we can accept. |
| `hm.upload.tooLarge.body` | {size} of {limit} allowed. Record a shorter walk — {maxMinutes} minutes at most. |
| `hm.upload.done` | Uploaded. We’re checking the location record now. |
| `hm.upload.checking` | Checking the location record |
| `hm.upload.located` | Location confirmed at this home. |

### 9.5 Not verified (geofence, HM-D03 / HM-D04)

| Id | Copy |
|---|---|
| `hm.rejected.title` | This walk wasn’t verified at this home. |
| `hm.rejected.geofence` | The location record puts this walk somewhere else. If the pin on your listing is wrong, fix the pin and scan again. |
| `hm.rejected.samples` | We didn’t get enough location readings to verify the walk. Keep location on, and stand outside for a moment at the start and the end. |
| `hm.rejected.accuracy` | The location readings were too rough to verify. Start and finish outside, standing still for a few seconds. |
| `hm.rejected.bookends` | The walk didn’t start and end outside the front door. |
| `hm.rejected.checkPin` | Check the pin |
| `hm.rejected.again` | Scan again |
| `hm.rejected.exif` | Photo location data is shown here for your reference. On its own it doesn’t prove anything. |

### 9.6 Building and failed (HM-D04)

| Id | Copy |
|---|---|
| `hm.build.queued.title` | In the queue |
| `hm.build.queued.body` | Your walk is waiting for the reconstruction worker. This can take a while. |
| `hm.build.notify.email` | We’ll email {email} when it’s ready. |
| `hm.build.notify.none` | Check back here. |
| `hm.build.running.title` | Building the walkthrough |
| `hm.build.running.body` | We’re stitching and steadying what you recorded. Nothing is added. |
| `hm.build.started` | Started {time} |
| `hm.build.eta` | About {minutes} minutes left *(only when the worker reports one)* |
| `hm.build.failed.title` | We couldn’t build a walkthrough from this walk. |
| `hm.build.failed.tooFewFrames` | The walk was too short to build from. |
| `hm.build.failed.tooDark` | Large parts were too dark to match up. Try again with the lights on and curtains open. |
| `hm.build.failed.motionBlur` | Fast movement blurred too many frames. Walk slowly and keep the phone steady. |
| `hm.build.failed.pose` | We couldn’t work out the camera’s path through the home. Overlapping views help — pan slowly and revisit doorways. |
| `hm.build.failed.worker` | Something went wrong on our side. Nothing you recorded was lost. |
| `hm.build.failed.stills` | Here’s what you recorded |
| `hm.build.retry` | Retry |
| `hm.build.again` | Scan again |
| `hm.build.ready.title` | Ready for you to mark private areas |
| `hm.build.ready.body` | Guests can’t see the walkthrough until you’ve done this. |
| `hm.build.ready.cta` | Mark private areas |
| `hm.build.ready.whole` | Confirm whole home |
| `hm.verified.title` | Verified |
| `hm.verified.body` | Captured {date}. Guests can walk this home once it’s published. |
| `hm.verified.view` | See it as a guest |
| `hm.verified.again` | Scan again |
| `hm.revoked.title` | Taken down |
| `hm.revoked.body` | This walkthrough was taken down on {date}: {reason}. Guests can’t walk this home, and it can’t take bookings, until a new walk is verified. |
| `hm.revoked.reason.pinChanged` | the front door pin was changed |

### 9.7 Private areas (HM-D05)

| Id | Copy |
|---|---|
| `hm.mask.title` | What guests will see |
| `hm.mask.intro` | Mark anything private. It’s cut out before guests see the walkthrough. We hide it — we don’t paint over it or fill it in. |
| `hm.mask.tool.private` | Mark a private area |
| `hm.mask.tool.keep` | Keep only this area |
| `hm.mask.tool.door` | Place the front door |
| `hm.mask.tool.erase` | Remove this box |
| `hm.mask.tool.undo` | Undo |
| `hm.mask.view.top` | From above |
| `hm.mask.view.look` | Look around |
| `hm.mask.label.private` | Private — hidden from guests |
| `hm.mask.label.keep` | Rental area — the only part guests see |
| `hm.mask.whole.check` | Everything in this walk is part of the rental |
| `hm.mask.whole.hint` | Guests will see it all. You’re confirming there are no private rooms in this walk. |
| `hm.mask.room.required` | A private room listing needs a “Keep only this area” box around the room guests rent. Shared spaces you want to show can be inside the box too. |
| `hm.mask.preview` | Preview as a guest |
| `hm.mask.finish` | Finish and verify |
| `hm.mask.finish.title` | Finish and verify? |
| `hm.mask.finish.body` | Anything inside a private box is removed from the guest walkthrough. You can change this later, but the walkthrough goes back through verification when you do. |
| `hm.mask.change.title` | Change what guests see? |
| `hm.mask.change.body` | Changing the mask takes the walkthrough down while we apply it. Guests can’t walk this home, and it isn’t bookable, until it’s verified again. |
| `hm.mask.change.confirm` | Change the mask |
| `hm.mask.change.cancel` | Keep it as is |
| `hm.mask.saved` | Saved. Applying the change. |

### 9.8 Walk (HM-D06 / D07 / D08)

| Id | Copy |
|---|---|
| `hm.walk.section.title` | Walk through this home |
| `hm.walk.enter` | Walk through this home |
| `hm.walk.stills.title` | What the host recorded |
| `hm.walk.about` | How this walkthrough was made |
| `hm.walk.loading` | Loading the walkthrough… {loadedMb} of {totalMb} MB |
| `hm.walk.leave` | Leave the walk |
| `hm.walk.help` | How to move |
| `hm.walk.help.keys` | Move: W A S D or the arrow keys · Look: drag, or hold Shift with the arrow keys · Leave: Esc |
| `hm.walk.help.touch` | Move: drag on the left · Look: drag on the right · Leave: the ✕ at the top |
| `hm.walk.reset` | Reset view |
| `hm.walk.reducedMotion.title` | Showing stills |
| `hm.walk.reducedMotion.body` | Your device asks for less motion, so here are the host’s recorded frames. The 3D walk only moves when you do. |
| `hm.walk.reducedMotion.start` | Start the 3D walk |
| `hm.walk.noWebgl.title` | This walkthrough needs a newer browser. |
| `hm.walk.noWebgl.body` | Here’s what the host recorded instead. |
| `hm.walk.loadFailed` | We couldn’t load the walkthrough. |
| `hm.walk.retry` | Try again |
| `hm.walk.notFound.title` | No walkthrough here. |
| `hm.walk.notFound.body` | This home may not have one yet, or the link is out of date. |
| `hm.walk.ownerPending.title` | Your walkthrough isn’t ready yet. |
| `hm.walk.ownerPending.cta` | See its progress |
| `hm.walk.outside` | Go outside |
| `hm.walk.inside` | Go inside |
| `hm.walk.approach.title` | At the front door |
| `hm.walk.approach.body` | Recorded by the host at the start of the walk. |
| `hm.map.title` | Where it is |
| `hm.map.area` | Neighborhood shown. The exact spot is shared once your stay is confirmed. |
| `hm.map.exact` | Exact location, shared by the host. |
| `hm.map.attribution.host` | Recorded by the host |
| `hm.map.attribution.third` | Street imagery from {source} contributors, not the host |
| `hm.map.noImagery` | No street imagery here yet. |

### 9.9 Neighborhood walk (HM-D09)

| Id | Copy |
|---|---|
| `hm.explore.walkCity` | Walk {city} |
| `hm.nbhd.title` | Walk {city} |
| `hm.nbhd.subtitle` | Real streets, real Stead homes. Pins are homes with a geo-proven walkthrough. |
| `hm.nbhd.nearby` | Homes on Stead near this view |
| `hm.nbhd.nearby.none` | No Stead homes near this view. |
| `hm.nbhd.empty.title` | No geo-proven homes in {city} yet. |
| `hm.nbhd.empty.body` | Nothing here is made up. When a host in {city} completes a walkthrough, it appears here. |
| `hm.nbhd.map` | Map |
| `hm.nbhd.street` | Street |
| `hm.nbhd.open` | Walk through this home |

### 9.10 Publish checklist and homes list (HM-D10 / D13)

| Id | Copy |
|---|---|
| `hm.check.title` | Ready to publish? |
| `hm.check.details` | Details |
| `hm.check.details.done` | Complete |
| `hm.check.photos` | Photos |
| `hm.check.photos.count` | {n} added |
| `hm.check.photos.none` | None yet — optional, but a home with no photos is a hard sell |
| `hm.check.scan` | Honesty scan |
| `hm.check.payouts` | Payouts |
| `hm.check.payouts.note` | Separate — needed before a guest can pay, not before publishing. |
| `hm.check.publishBlocked` | Publish when your honesty scan is verified. Guests can’t book a home without one. |
| `hm.check.platformClosed` | Guest bookings on Stead aren’t open yet. Publishing lists your home; bookings open later. |
| `hm.scan.state.notStarted` | Scan: Not started |
| `hm.scan.state.needsPin` | Scan: Needs the front door pin |
| `hm.scan.state.capturing` | Scan: Walk in progress |
| `hm.scan.state.located` | Scan: Location confirmed |
| `hm.scan.state.uploading` | Scan: Uploading |
| `hm.scan.state.checking` | Scan: Checking location |
| `hm.scan.state.rejected` | Scan: Not verified |
| `hm.scan.state.queued` | Scan: In the queue |
| `hm.scan.state.building` | Scan: Building |
| `hm.scan.state.failed` | Scan: Couldn’t build |
| `hm.scan.state.needsMask` | Scan: Mark private areas |
| `hm.scan.state.verified` | Scan: Verified |
| `hm.scan.state.revoked` | Scan: Taken down |
| `hm.scan.next.start` | Scan from your phone |
| `hm.scan.next.pin` | Set the front door pin |
| `hm.scan.next.continue` | Continue on your phone |
| `hm.scan.next.resume` | Resume upload |
| `hm.scan.next.why` | See why |
| `hm.scan.next.progress` | See progress |
| `hm.scan.next.mask` | Mark private areas |
| `hm.scan.next.view` | See it as a guest |

### 9.11 Book path (HM-D11)

| Id | Copy | Rule |
|---|---|---|
| (existing) `BOOKINGS_CLOSED_COPY.title` | Not open for bookings yet | Unchanged while the platform flag is off. |
| (existing) `BOOKINGS_CLOSED_COPY.body` | Guest stays aren’t live yet. You can still read the home and message the host. | Unchanged. |
| (existing, server) `GUEST_BOOKINGS_CLOSED_MESSAGE` | Bookings aren't open yet. | Unchanged. `tests/guest-bookings.test.ts` asserts it. |
| `hm.book.notVerified.title` | This home isn’t open for stays yet. | Only after the platform flag is on and the server refused because the home has no verified walkthrough. |
| `hm.book.notVerified.body` | The host still needs a verified walkthrough. You can read the home and message the host. | Same. |
| `hm.book.notVerified.back` | Back to the home | Same. |

### 9.12 One-line mentions on existing routes

| Route | Copy | Placement |
|---|---|---|
| `/for-homeowners` | A geo-proven walkthrough of your home is required before guests can book. You record it once, from your phone, at the home. | Under “How it works 2 — Get ready for bookings”, as a third sentence. Nothing else on the page changes. |
| `/host/start` intro | Before guests can book, you’ll walk-scan the home from your phone. That comes after this setup. | Under the five-step list, next to the payout sentence. |

### 9.13 Sheet and disclosure ids

§8 is the readable form of the two disclosures. These ids are what code
mirrors; the text is identical, split into the pieces a screen renders.

| Id | Copy |
|---|---|
| `hm.sheet.title` | Before you start the walk |
| `hm.sheet.record.heading` | What we record |
| `hm.sheet.record.video` | Video from your phone’s camera while you walk. |
| `hm.sheet.record.location` | Your phone’s location, continuously, while you record. |
| `hm.sheet.why.heading` | Why the location |
| `hm.sheet.why.body` | To prove this walk happened at this home. Guests see that it was proven, and the date. They never see your route. |
| `hm.sheet.video.heading` | What we do with the video |
| `hm.sheet.video.body` | We stitch, steady, and compress it into a walkthrough guests can move through. We don’t add rooms, furniture, or views, and we don’t tidy anything up. What you record is what guests see. |
| `hm.sheet.private.heading` | Private areas |
| `hm.sheet.private.body` | After the walk, you mark anything private. It’s cut out before anyone else sees the walkthrough. |
| `hm.sheet.bookings.heading` | Bookings |
| `hm.sheet.bookings.body` | A home can’t take bookings until its walkthrough is verified. |
| `hm.sheet.tips.heading` | Tips |
| `hm.sheet.tips.body` | Start outside your front door and turn slowly in a full circle. Walk every room you want guests to see, slowly, with the lights on. Finish outside your front door the same way. |
| `hm.sheet.acknowledge` | I’ve read this and I’m at the home now. |
| `hm.sheet.acknowledge.hint` | Tick the box to continue. |
| `hm.sheet.start` | Start the walk |
| `hm.sheet.notNow` | Not now |
| `hm.sheet.starting` | Starting… |
| `hm.sheet.failed` | We couldn’t start the walk. Try again. |
| `hm.sheet.policyChanged` | The honesty policy changed. Read it again before you start. |
| `hm.about.title` | How this walkthrough was made |
| `hm.about.recorded` | The host recorded this walk on their phone, at this home. Their phone reported its location the whole time, within {radius} m of the listing’s front door pin, and the walk started and ended outside the front door. |
| `hm.about.stitched` | We stitched, steadied, and compressed what they recorded. We didn’t add rooms, furniture, or views. If something wasn’t recorded, it isn’t here. |
| `hm.about.scope.whole` | Whole home. Everything you can walk is part of the rental. |
| `hm.about.scope.partial` | Rental areas only. Private rooms are left out on purpose. |
| `hm.about.captured` | Captured {date}. This is a record of that day, not a live feed. |
| `hm.about.nearby` | Nearby pins are other Stead homes with a geo-proven walkthrough. Nothing on the map is made up. |
| `hm.about.signal` | Location proof is a strong signal, not a guarantee. |

---

## 10. Banned verbs and model features

Reviewer rule to quote: **stitch / stabilize / compress / cleanup only**,
where cleanup means removing capture noise and floaters, never adding or
replacing what was recorded.

**Banned UI verbs and labels** (must not appear, even disabled, even in a
tooltip): Enhance · Beautify · Retouch · Tidy · Declutter · Complete the
room · Fill · Auto-fix · Magic · Clean up (as a control) · Generate ·
Reimagine · Stage · Virtual staging · Render (as a verb on a room) ·
Upscale · Restore · Smart erase · Remove object.

**Banned model features** (must not be wired into the worker or viewer):
inpainting or generative fill; invented geometry, rooms, furniture, façades,
or views; hallucinating super-resolution; style transfer or relighting;
sky or window-view replacement; virtual staging; any closed reconstruction
API; any model whose license is non-commercial.

**Allowed and named as such:** stitching frames; stabilizing; compressing;
cropping to the rental volume; hiding host-marked boxes; removing floaters
and capture noise (cleanup) in a way that never fills the gap it leaves.

**Provenance claims not to make:** “GPS-certified”, “tamper-proof”,
“court-admissible”, “verified by hardware attestation”, “100% real”, “live
now”. Say: geo-proven, a strong signal, not a guarantee.

---

## 11. Announcements and tone rules for status copy

- Every state has a text label. Colour reinforces, never carries.
- Danger tone (`role="alert"`) is reserved for lost work or a refused
  action: an upload that stopped, a permission that blocks recording, a
  publish the server refused. Not-verified and Couldn’t-build are `status`
  tone: calm, with the fix.
- Claim red (`#B3402A` in the handoff; `danger` in the coded system) is
  never used for scan states. A failed scan is not a dispute.
- Progress announcements throttle to every 10 % and at completion.
- Times are listing-local calendar dates; “Started {time}” on the host hub
  is the host’s local clock and says so on hover.

Copyright 2026 Stead contributors.
