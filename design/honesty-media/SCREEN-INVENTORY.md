# Honesty media — screen inventory

**Status:** Specified (design). Every HM-D row below is filled: purpose,
access, layouts, states, copy ids, server facts, a11y, hard stop. Not shipped
UI. Not a claim that any walkthrough exists on Production. Implementation of a
screen still waits for its HM ticket on an implementation branch.

**Tickets:** [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md).
**Brief:** [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).
**Copy and journeys:** [`JOURNEYS-AND-COPY.md`](JOURNEYS-AND-COPY.md) — every
string referenced here as `hm.*` is defined there and only there.

Existing Stead routes stay. Three new host URLs and two new guest URLs are
enough to keep capture and walk bookmarkable; upload progress and
reconstruction status are **states of the scan hub**, not routes.

Copyright 2026 Stead contributors.

---

## Global rules inherited by every screen

From the redesign screen specs (`redesign-handoff/design/02-SCREEN-SPECS.md`
§2) and the coded design system v1:

- Loading: skeletons matching content proportions and a short `role="status"`
  label. Never a false empty state before a request settles.
- Error: plain language, **Try again**, drafts preserved.
- Unauthorized: wait for the session, then the existing `SignInPrompt` with
  the exact safe return target. Not-found and no-access are the same 404 to
  anyone but the owner.
- Controls ≥ 44 × 44 CSS px (the kit’s `min-h-control` is 48 px). One focus
  treatment. No colour-only status. Reduced motion honored.
- Components: `Shell`, `PageHeader`, `Card`, `Surface`, `StatusMessage`
  (tones `info | success | warning | danger`), `StatusPill` (tones
  `neutral | brand | success | warning | danger`), `Button` / `ButtonLink`,
  `Dialog`, `Progress`, `EmptyState`, `Skeleton`, `DataList`. New components
  this phase adds are named in each row.
- Honesty media is stricter than the global fail-closed rule in one way: the
  browser **never displays a verdict it computed**. “Verified”, “Location
  confirmed”, “Not verified” and “Built” are always the server’s words.

### Server facts the screens read (proposal, not a contract)

Names below are placeholders for HM-01 / HM-02 / HM-05 / HM-08 to settle.
They exist so every row can say exactly which fact it renders.

**Host, owner-only** — `GET /api/listings/:id/scan` (proposed):

```
state: "none" | "capturing" | "uploaded" | "reconstructing" | "needs_mask"
     | "verified" | "rejected" | "failed" | "revoked"
substate?: "queued" | "running"                     // reconstructing only
geofence: "pending" | "passed" | "failed"
rejectReason?: "geofence" | "samples" | "accuracy" | "bookends"
failReason?: "too_few_frames" | "too_dark" | "motion_blur" | "pose" | "worker"
retryAllowed: boolean                               // failed + worker only
accuracyMaxMeters: integer                          // config, for the location line
maxWalkMinutes: integer                             // config
maxUploadBytes: integer                             // config
policyVersion: string                               // honesty policy the host acknowledged
capturedOn: string | null                           // listing-local date
startedAt: string | null                            // worker clock, ISO
etaMinutes: integer | null                          // only if the worker reports one
notifyEmail: string | null                          // null when no send key is configured
stills: { url: string }[]                           // real frames, signed URLs
mask: "none" | "whole_home" | "boxes"
doorPlaced: boolean
revokedOn?: string; revokedReason?: string
listing: { hasPin: boolean; type: ListingType; status: ListingStatus }
```

Derived on the client, and only these: `needsPin = state === "none" && !listing.hasPin`.

**Public** — extends `ListingSummary` / `ListingDetail` with:

```
walkthrough: null | {
  capturedOn: string            // listing-local date
  scope: "whole_home" | "rental_areas"
  radiusMeters: integer         // the geofence radius that was applied
  stills: { url: string }[]     // real frames
  approach: boolean             // an approach pano exists (always true for verified scans)
  map: null | { kind: "area"; lat; lng; acrossMeters } | { kind: "exact"; lat; lng }
}
```

`walkthrough` is non-null only for `active` + `verified` listings (owners also
get it on their own draft/paused rows for preview). The splat itself is
fetched from `GET /api/listings/:id/walkthrough/artifact` (proposed), which
returns a short-lived signed URL — never a stable public path.

`map` is computed server-side from the host’s precision choice; `area`
snaps to a stable grid cell so repeated requests cannot triangulate the door.
Exact coordinates for a guest with a confirmed stay come through the trip
DTO, not the public listing.

---

## Inventory

| ID | Ticket | Canonical route | Surface today | Filled below |
|---|---|---|---|---|
| HM-D00 | HM-00 | (copy system, not a route) | — | Disclosures, badge lock, banned verbs |
| HM-D01 | HM-01 | `/host/listings/:listingId/scan` (hub) and `/scan/capture` (viewfinder) | none | Capture client: camera + continuous location + bookends |
| HM-D02 | HM-01 | `/host/listings/:listingId` — “Where it is” card | `HostListingEditPage` | Front door pin; precision choice; no network geolocation |
| HM-D03 | HM-02 | `/host/listings/:listingId/scan` — Uploading state | none | Upload progress; package; not a verdict |
| HM-D04 | HM-03 | `/host/listings/:listingId/scan` — Queued / Building / Failed / Ready states | none | Status, retry, stills from real frames |
| HM-D05 | HM-04 | `/host/listings/:listingId/scan/mask` | none | Private boxes, keep box, whole-home confirm, door |
| HM-D06 | HM-05 | `/listing/:id` — “Walk through this home” section | `ListingDetailPage` | Badge, stills, enter CTA, disclosure |
| HM-D07 | HM-05 | `/listing/:id/walk` | none | Full-viewport indoor walk; stills modes |
| HM-D08 | HM-06 | `/listing/:id` map card and `/listing/:id/walk?view=approach` | detail + walk | MapLibre pin/area; approach pano; door tether |
| HM-D09 | HM-07 | `/walk?city={city}` | none (link from `ExplorePage`) | Neighborhood walk; real pins only |
| HM-D10 | HM-08 | `/host/listings/:listingId?setup=review` and editor | `ReviewStep` in `HostListingEditPage` | Publish checklist; blocked reason |
| HM-D11 | HM-08 | `/book/:listingId` | `BookPage` | Unchanged kill-switch; not-verified refusal after the flag |
| HM-D12 | HM-09 | cards / detail / walk chrome | `ListingCard`, detail | Honesty badge treatments |
| HM-D13 | HM-09 | `/host/listings` | `HostListingsPage` | Scan pill + one next action per row |

Existing routes not in this table stay as they are, with two one-sentence
additions (`/for-homeowners`, `/host/start`) listed in
[`JOURNEYS-AND-COPY.md` §9.12](JOURNEYS-AND-COPY.md#912-one-line-mentions-on-existing-routes).
Payouts, claims, trips, messages and login are not redesigned in this phase.

Route metadata for `src/lib/routes.ts`: `/host/listings/:id/scan*` → title
“Honesty scan”, workspace `hosting`; `/listing/:id/walk` → “Walkthrough”,
`renter`; `/walk` → “Walk a neighborhood”, `renter`.

---

## HM-D00 — Honesty policy surfaces (HM-00)

1. **Purpose.** Lock the words every other screen uses. Primary “CTA” is the
   host acknowledgment: **Start the walk** on the pre-capture sheet.
2. **Who.** Host sheet: owner of the listing, signed in. Guest disclosure:
   public, signed-out included.
3. **Layout.** Host sheet: phone = full-height bottom sheet (`Dialog`
   sized to the viewport, scrollable body, sticky footer with the checkbox
   and two buttons); desktop = centered `Dialog size="md"`. Guest
   disclosure: a `<details>`-style panel (`Surface`) under the badge on the
   detail page, and the same content in a side sheet from the walk chrome.
4. **States.** Sheet: policy loading (skeleton lines, buttons disabled);
   loaded; acknowledgment unchecked (Start disabled, hint “Tick the box to
   continue”); checked; submitting (Start busy “Starting…”); submit failed
   (`StatusMessage tone="danger"` “We couldn’t start the walk. Try again.”).
   Disclosure: collapsed / expanded only.
5. **Copy.** §8.1 and §8.2 verbatim; badge strings §9.1; banned list §10.
6. **Server has decided.** The current `policyVersion`. The acknowledgment
   is stored with the capture session it creates; a host re-reads the sheet
   on every new walk.
7. **A11y.** Sheet is a modal dialog with a labelled heading and focus
   trapped; Esc = Not now. Checkbox is a real `<input>` with a visible
   label. Disclosure toggle is a `<button aria-expanded>`; content is plain
   paragraphs, no decorative seal image.
8. **Hard stop.** Capture (HM-D01) does not exist until these strings do.
   No Enhance / Beautify / Complete-the-room control anywhere, including
   disabled, including “coming soon”.

---

## HM-D01 — Capture (HM-01)

1. **Purpose.** Record a geo-proven walk. Primary CTA changes by stage:
   **Scan from your phone** (hub) → **Start the walk** (sheet) →
   **I’m outside — start** → **Finish outside** → **Finish the walk**.
2. **Who.** Owner only. Anyone else: 404 “No listing of yours here” (the
   existing route message), never a hint the listing exists.
3. **Layout.**
   - *Hub* (`/scan`): `Shell width="narrow" workspace="hosting"`,
     `HostSubnav`, `PageHeader` “Honesty scan” with the listing title as
     description, then one `Card` that renders the current state and one
     primary action. Below it a `Surface` with the four-facts note
     (“Verified is not published, is not payouts, is not bookings open”).
   - *Desktop hub*: the card becomes the hand-off panel (`hm.hub.desktop.*`)
     with **Email me the link** (existing mail path; hidden when the server
     reports no send key).
   - *Viewfinder* (`/scan/capture`, phone): `Shell focused hideNav`, black
     canvas full-viewport. Top strip (paper at 90 % opacity): listing title,
     elapsed `mm:ss` (`.money`), the **location line**. Bottom sheet: the
     stage prompt, then buttons in a single row, 48 px tall, thumb-reachable.
     Landscape is allowed; layout mirrors to the sides.
   - *Location line*: text first (`hm.loc.*`), with a three-segment meter
     (none / rough / good) drawn in ink outlines on surface. No shield, no
     seal, no percentage.
4. **States.**
   - Hub: Not started · Needs the pin (`hm.pin.required`, one link to the
     editor’s Where-it-is card) · Walk in progress (a session exists on
     another device: **Continue on your phone**) · Uploading (HM-D03) ·
     Checking · Not verified (§9.5) · Queued / Building / Couldn’t build
     (HM-D04) · Mark private areas · Verified · Taken down.
   - Viewfinder: requesting permissions → camera denied → location denied →
     unsupported browser (`hm.capture.unsupported`, no camera at all) →
     outdoor start (fix none / rough / good) → recording → paused →
     backgrounded → outdoor finish (fix none / rough / good) → stop
     confirmation → handing off to upload.
   - Low battery / thermal warnings are the OS’s; we only keep the screen
     awake (Wake Lock) and say so once (`hm.capture.awake`).
5. **Copy.** §9.3. The rough-indoors line is deliberately reassuring: poor
   indoor accuracy is expected, and the design does not ask the host to fix
   it. Only the two outdoor bookends must be good.
6. **Server has decided.** `accuracyMaxMeters`, `maxWalkMinutes`,
   `maxUploadBytes`, `policyVersion` — delivered when the session is
   created. The client uses the threshold only to enable buttons; the
   verdict is HM-D03’s.
7. **A11y.** Location line is a live region (`aria-live="polite"`,
   announcements throttled to state changes, not every sample). Stage
   prompt is the dialog’s heading. Buttons have text labels, not icons. The
   camera `<video>` is `aria-hidden` (it conveys nothing a screen-reader
   user needs beyond the prompts). The elapsed timer is not announced.
8. **Hard stop.** No EXIF-only proof. No public breadcrumb: the samples go
   to the owner-only attestation object and nowhere else. No invented
   coordinate when the fix is absent — the button simply stays disabled.
   No camera-roll upload path inside the scan flow (a video recorded
   outside this page has no continuous location record and cannot be
   proven; offering it would only end in “Not verified”).

---

## HM-D02 — Front door pin (HM-01)

1. **Purpose.** Bind the listing to a spot the scan is checked against.
   Primary CTA: **Set the front door pin**.
2. **Who.** Owner only, in the existing editor.
3. **Layout.** A new block at the bottom of the existing “Where it is”
   `Card`, under the address / city / region / country / timezone grid:
   heading `hm.pin.title`, hint `hm.pin.hint`, a MapLibre map 100 % × 240 px
   (phone) / 320 px (desktop) with a single draggable pin, buttons
   **Set the front door pin** / **Move the pin**, and **Use my location
   now** (phone only; hidden when `navigator.geolocation` is absent). Below:
   the precision `fieldset` (`hm.pin.precision.*`, two radios, default
   “neighborhood”) and the advanced `<details>` “Enter coordinates” with two
   numeric inputs. Saving goes through the existing **Save changes** and the
   existing diff-PATCH; `lat`, `lng` and the precision choice join
   `ListingInput` (the server route already accepts `lat` / `lng`; the
   browser contract does not yet).
4. **States.** No pin (map centered on the city from the listing’s
   city/region/country via a geocode the host can override by dragging; if
   geocoding is unavailable, world view and “Drag to your street”); pin
   placed, unsaved (“Unsaved” next to Save changes); saved (`hm.pin.saved`);
   geolocating (button busy “Finding you…”); fix acquired → confirm dialog
   (`hm.pin.confirm.*` with the accuracy sentence); no fix (`hm.pin.noFix`);
   permission denied (same copy as HM-D01 location denied); map failed to
   load (the coordinate inputs stay usable; “The map couldn’t load. You can
   still enter coordinates.”).
5. **Copy.** §9.2. “Coordinates” only inside the advanced disclosure.
6. **Server has decided.** Nothing about position — the pin is host
   intent. The server validates range and stores it; a later scan is
   checked against it. `map.kind` for guests is derived from the precision
   choice server-side.
7. **A11y.** The map is `role="application"` with an accessible name and
   instructions; the pin can also be moved with arrow keys when the map is
   focused (MapLibre marker `draggable` plus a keyboard handler). Every
   value the map sets is mirrored in the two coordinate inputs so a
   screen-reader user can read and edit it.
8. **Hard stop.** No IP or network geolocation, ever, not even as a
   default map center. Guests never get the exact pin from the public
   listing unless the host chose “The exact spot”; the private street
   address stays where it is today (shared after a confirmed stay).

---

## HM-D03 — Upload (HM-02)

1. **Purpose.** Get the walk package into the bucket and let the server
   decide what it is. Primary CTA: none while uploading; **Resume upload**
   after a stop.
2. **Who.** Owner only.
3. **Layout.** The hub `Card` in Uploading state: heading `hm.upload.title`,
   `hm.upload.body`, one overall `Progress`-style bar with the text
   `hm.upload.progress` (`.money` numerals), then a three-row `DataList`
   (Video · Location record · Details) each with its own “done / total” and
   a check when complete. Footer: **Pause upload**. Phone-first; desktop
   shows the same card (a host may continue an upload from a laptop if the
   recording device is the one holding the files — usually not; the copy
   says “Continue on your phone” when the session lives elsewhere).
4. **States.** Preparing (chunking; “Getting your walk ready to upload”) ·
   Uploading · Paused · Stopped (network) `hm.upload.stopped.*` · Too large
   (refused before the first byte: `hm.upload.tooLarge.*`, the only action
   is **Scan again**) · Uploaded → `hm.upload.done` · Checking
   (`hm.upload.checking`, spinner-free — a `StatusMessage tone="info"` with
   `aria-busy`) · Located (`hm.upload.located`, success tone) · Not verified
   (§9.5, info tone, actions **Check the pin** / **Scan again**).
   Resume is per object: already-uploaded objects are skipped.
5. **Copy.** §9.4 and §9.5.
6. **Server has decided.** Per-object presigned PUT URLs with server-chosen
   keys under `listings/:listingId/scans/:scanId/…` and signed content
   types; `maxUploadBytes`; and after the package is complete, the geofence
   verdict. “Uploaded” appears only after the server acknowledges the
   complete package (HM-02 “upload receipt”). The client-held sample JSON
   is data, never a verdict.
7. **A11y.** Overall progress is `role="progressbar"` with
   `aria-valuenow`; announcements every 10 % and at completion via a
   polite live region. Pause/Resume are one toggle button with a changing
   label, never an icon-only control.
8. **Hard stop.** Never render “Verified” or “Located” from client state.
   Never proxy video bytes through the API. Never let a host attach an
   object outside their own listing prefix (the server refuses; the client
   never constructs keys).
9. **Built (HM-02).** As specified, with these adjustments from the
   HM-01 order of events: the location check happens *before* the upload
   (a walk that fails it never leaves the phone), so the Checking / Located
   / Not verified states above belong to the hub’s located flow, and the
   Uploading card ends at `hm.upload.done` → the Queued card (HM-D04,
   `hm.build.queued.title` + `hm.build.notYet`). The card starts on its own
   when the hub finds the recording in this browser; on any other device
   the hub shows `hm.hub.located.*` instead. Parts are ~8 MB groups of
   recorder chunks; “n of m parts” moves only on the server’s receipt (a
   HEAD on the object at the declared size), the bar moves with bytes in
   flight. Added copy: `hm.upload.preparing`, `.paused`, `.offline`,
   `.completing`, `.group.location.done`, `.group.details.pending`,
   `.unconfigured.*`, `.mismatch.*`. Pause/Resume is one toggle; offline
   resumes on the browser’s `online` event.

---

## HM-D04 — Reconstruction status (HM-03)

1. **Purpose.** Tell the host honestly what the worker is doing. Primary
   CTA by state: none (queued/running) · **Retry** or **Scan again**
   (failed) · **Mark private areas** (ready).
2. **Who.** Owner only.
3. **Layout.** The hub `Card`. Queued / Building: heading, one sentence,
   the notify line (`hm.build.notify.email` when `notifyEmail` is set, else
   `hm.build.notify.none`), `hm.build.started` when `startedAt` exists,
   `hm.build.eta` only when `etaMinutes` is non-null. No indeterminate
   spinner as the main element; a quiet pulsing dot next to the heading,
   `motion-reduce:animate-none`. Failed: heading + reason sentence, a
   horizontal strip of up to eight stills (`hm.build.failed.stills`) from
   the recorded frames at 4:3, then the action row. Ready: heading, body,
   **Mark private areas** and, when the listing type is `entire_home` or
   `apartment`, a secondary **Confirm whole home** that opens HM-D05 with
   the whole-home checkbox focused.
4. **States.** Queued · Building · Couldn’t build (five reasons) · Ready
   for mask · Verified (`hm.verified.*`) · Taken down (`hm.revoked.*`).
   The page polls the hub endpoint while queued/building (TanStack
   `refetchInterval` with backoff); polling stops on terminal states.
5. **Copy.** §9.6. “This can take a while” is the only time statement
   unless the worker supplies one. SuperSplat is never named to hosts.
6. **Server has decided.** `state`, `substate`, `failReason`,
   `retryAllowed`, `stills`, `startedAt`, `etaMinutes`, `notifyEmail`,
   `capturedOn`. Retry is allowed only for `worker` failures; every other
   failure needs a new walk.
7. **A11y.** State changes announce once through a polite region. Stills
   have `alt="Frame {n} of {total} from your walk"`. The action row is last
   in DOM order so the reason is read before the fix.
8. **Hard stop.** No preview splat while building. No generative
   “here’s roughly what it will look like”. No Luma or other closed-API
   branding. A failed job never shows a mesh, only real frames.

---

## HM-D05 — Private areas (HM-04)

1. **Purpose.** Let the host cut private space out, or confirm there is
   none. Primary CTA: **Finish and verify**.
2. **Who.** Owner only, and only when `state === "needs_mask"` (or
   `verified`, for a change). Any other state redirects to the hub.
3. **Layout.** `Shell width="wide" workspace="hosting"`. Desktop: viewer
   left (min 60 %), tool rail right (`Card`, sticky). Phone: viewer full
   width at 60 vh, tools in a bottom sheet with a drag handle; the
   “From above” view is the default on phone because boxes are easiest to
   draw top-down. Tool rail: view toggle (`hm.mask.view.*`), tools
   (`hm.mask.tool.private`, `hm.mask.tool.keep`, `hm.mask.tool.door` — the
   door tool is hidden until HM-06 ships), box list with labels
   (`hm.mask.label.*`) and per-box **Remove this box**, **Undo**, the
   whole-home checkbox (`hm.mask.whole.*`, `entire_home` / `apartment`
   only), **Preview as a guest**, **Finish and verify**. Private boxes draw
   as ink diagonal hatch at 40 % over the splat with a label; a keep box
   draws as a brand outline with everything outside dimmed to 30 %. No red.
4. **States.** Loading the splat (progress by bytes) · Editing (dirty
   indicator “Unsaved changes”) · Preview (boxes applied as clipping in the
   same viewer; a `StatusMessage tone="info" live={false}` “Preview. Guests
   see this once it’s verified.”) · `private_room` without a keep box
   (**Finish** disabled, `hm.mask.room.required`) · Whole-home ticked with
   boxes present (the checkbox is disabled while any private box exists,
   hint “Remove your private boxes to confirm the whole home”) · Finish
   confirmation `Dialog` (`hm.mask.finish.*`) · Saving (`hm.mask.saved`) ·
   Change-after-verified warning `Dialog` (`hm.mask.change.*`) · Save
   failed (danger, boxes kept) · WebGL missing (the page explains the mask
   step needs a device with 3D support and offers **Email me the link**;
   there is no non-visual mask editor in this phase — noted as a known gap
   for HM-04).
5. **Copy.** §9.7.
6. **Server has decided.** That a splat exists; the listing type; whether
   a mask or whole-home confirmation is already recorded. The server stores
   boxes in the splat’s coordinate frame and the worker applies them; the
   client preview uses the same boxes as clip volumes, so it is a real
   render of the same data with regions hidden, not a mock.
7. **A11y.** Boxes are also listed as text (position, size) and adjustable
   by numeric inputs in the rail; drawing is a pointer convenience, not the
   only path. Tools are a `role="toolbar"` with roving focus. The whole-home
   checkbox is a real input with the hint as `aria-describedby`.
8. **Hard stop.** No inpaint, no “tidy this room”, no object removal, no
   blur brush — hide or crop only. Whole-home is a recorded host action,
   never a default. A mask change never silently overwrites a live
   walkthrough.

---

## HM-D06 — Walk section on home detail (HM-05)

1. **Purpose.** Show that this home has a geo-proven walkthrough and let a
   guest enter it. Primary CTA: **Walk through this home**.
2. **Who.** Public. Owner sees the same section with a host-only pill
   (`hm.badge.processing` / `hm.badge.none`) when the walkthrough is not yet
   public; guests see nothing when `walkthrough` is null.
3. **Layout.** A new section directly after the photo gallery and before
   “About this home”, full width of the left column on desktop:
   `<h2>` `hm.walk.section.title`, the full badge (HM-D12 full treatment),
   a metadata line `hm.badge.captured` · `hm.badge.scope.*`, a 2 × 3 grid
   (phone 2 × 2) of the host’s stills at 4:3, **Walk through this home**
   (`ButtonLink` primary, `block` on phone), and the disclosure toggle
   `hm.walk.about` (HM-D00 guest panel). The map card (HM-D08) sits in the
   right aside under the price card.
4. **States.** Present · Absent (section not rendered; nothing takes its
   place) · Owner preview, not ready (pill + one link **See its progress**
   → hub) · Stills failed to load (`ListingPhoto`’s existing “Photo
   unavailable” surface).
5. **Copy.** §9.1, §9.8.
6. **Server has decided.** `walkthrough` non-null ⇒ active + verified (or
   owner preview). Stills are real frames chosen by the worker (evenly
   spaced through the walk), not host-uploaded photos.
7. **A11y.** Section heading in the page outline; badge has the
   `hm.badge.a11y` label; stills have `alt="Frame from the host’s walk"`;
   the disclosure toggle is `aria-expanded`.
8. **Hard stop.** Never render the section from a draft or from a scan that
   is not verified. Never fetch a splat here — the section is stills only;
   the 3D cost is paid on `/walk`.

---

## HM-D07 — Indoor walk (HM-05)

1. **Purpose.** Walk the captured interior. Primary CTA inside: none; the
   only persistent control is **Leave the walk**.
2. **Who.** Public for active + verified. Owner for their own draft/paused
   verified scan (preview). Everyone else: 404 `hm.walk.notFound.*`.
3. **Layout.** `Shell focused hideNav`. The canvas fills the viewport
   under a 56 px top bar: left **Leave the walk** (✕ with text on desktop,
   ✕ with `aria-label` on phone), center compact badge, right **How to
   move** and **About** (opens HM-D00 side sheet). Bottom-right cluster:
   **Reset view**, **Go outside** (HM-D08, only when `approach` is true).
   Phone: a translucent left-half move pad and right-half look area, both
   invisible until touched (a one-time hint overlay explains them).
   Viewer chunk (Spark + Three.js) is lazy-loaded on this route only.
4. **States.** Loading (`hm.walk.loading` with real bytes from the
   artifact response headers; a paper backdrop, no fake wireframe) ·
   Walking · Stills mode (a full-bleed carousel of the host’s frames with
   Previous / Next, counter “Frame {n} of {total}”) · Reduced motion
   (stills mode by default plus `hm.walk.reducedMotion.*` and **Start the
   3D walk**; once started, the camera moves only on input, with no easing
   or auto-orbit) · No WebGL (`hm.walk.noWebgl.*`, stills mode, no opt-in) ·
   Load failed (`hm.walk.loadFailed`, **Try again**, stills still shown) ·
   Not found · Owner pending (`hm.walk.ownerPending.*`) · Artifact URL
   expired mid-session (silently re-request; if that fails, Load failed).
5. **Copy.** §9.8.
6. **Server has decided.** A short-lived signed artifact URL, issued only
   for a verified, mask-applied splat the viewer may see; `stills`;
   `approach`. Unpublished or unverified artifacts are not addressable.
7. **A11y.** The canvas is `role="img"` with `aria-label="3D walkthrough
   of {title}. Use the arrow keys to move."`. Keyboard: arrows / WASD move,
   Shift + arrows look, Esc leaves, `?` opens **How to move**. Focus lands
   on **Leave the walk** on entry and returns to the **Walk through this
   home** button on exit. Stills mode is a standard carousel with buttons
   and a live counter. Nothing depends on hover.
8. **Hard stop.** No fetch-by-guess: no `/artifacts/{id}.ply` public
   path. No generated “preview splat” when the job failed. No third-party
   street imagery inside the indoor viewer. No autoplaying camera anywhere.

---

## HM-D08 — Approach, map and door tether (HM-06)

1. **Purpose.** Show where the home is, as precisely as the host allows,
   and let a guest step outside the front door. Primary CTAs: **Go
   outside** / **Go inside**.
2. **Who.** Same as HM-D07 for the approach; the map card is public on any
   active listing that has a pin (pre-HM-08 that may include homes without
   a walkthrough; the card then shows the map only).
3. **Layout.** *Map card* (detail aside, under the price card): `Card` with
   heading `hm.map.title`, a MapLibre map 100 % × 200 px, and one line:
   `hm.map.area` (a soft brand-tinted circle, no pin) or `hm.map.exact`
   (a pin). Attribution per MapLibre’s requirements in the map corner.
   *Approach view* (`/listing/:id/walk?view=approach`): the same chrome as
   HM-D07; the canvas shows the host’s stitched door-turn panorama (Photo
   Sphere Viewer or equivalent) with **Go inside** where **Go outside**
   was, heading `hm.walk.approach.title`, caption `hm.walk.approach.body`
   and the attribution `hm.map.attribution.host`. The tether is the
   explicit button; there is no auto-transition when the camera reaches
   the door.
4. **States.** Map loading (skeleton 200 px) · Map failed (“The map
   couldn’t load.” — the text line still states area vs exact) · Approach
   loading (bytes) · Approach failed (**Try again**, **Go inside**) ·
   Reduced motion (the pano does not auto-rotate; drag or arrow keys only).
5. **Copy.** §9.8.
6. **Server has decided.** `map.kind` and the position it serves (area
   snapped to a grid cell, or exact); that an approach pano exists (it is
   built from the outdoor start bookend, so every verified scan has one);
   its signed URL.
7. **A11y.** Map has an accessible name and the text line carries the
   meaning; the map is decorative for screen readers (`aria-hidden` on the
   canvas, the sentence does the work). Approach pano canvas is `role="img"`
   with “Panorama at the front door, recorded by the host.”
8. **Hard stop.** Never a third-party image standing in for the host’s
   façade. Never a draped or generated building. Never Mapillary as the
   only outdoor layer. Never the exact pin for an “area” listing, in any
   response the public page can read.

---

## HM-D09 — Neighborhood walk (HM-07)

1. **Purpose.** Walk a real city and find real Stead homes in it. Primary
   CTA on a pin: **Walk through this home**.
2. **Who.** Public.
3. **Layout.** Entry: on `/explore`, when `filters.city` is set, a text link
   `hm.explore.walkCity` under `PageHeader` (rendered even when results are
   empty — the walk page is honest on its own). Route `/walk?city={city}`
   in `Shell` (not focused; the header stays so a guest can leave).
   Desktop: two panes — map (40 %, MapLibre, pins for verified homes,
   neighborhood-area homes as soft circles) and street pane (60 %: the
   selected host approach pano, or labeled third-party imagery, or the
   `hm.map.noImagery` surface). Under both: `hm.nbhd.nearby` with compact
   `ListingCard`s (3-up desktop, 1-up phone) re-queried as the map view
   moves. Phone: street pane full width at 55 vh, a **Map** / **Street**
   segmented control, nearby cards below.
4. **States.** Loading (map skeleton + three card skeletons) · Results ·
   Empty city (`EmptyState` with `hm.nbhd.empty.*` and the existing
   `CatalogEmptyActions`; the map still renders the city) · No imagery for
   this view (`hm.map.noImagery`, map stays interactive) · Spatial query
   failed (`StatusMessage tone="danger"`, **Try again**, pins from the last
   good response stay) · Unknown city (map at a world view, “Choose a city
   on Explore first” with a link).
5. **Copy.** §9.9 and the attribution strings in §9.8.
6. **Server has decided.** The spatial read (bbox or distance) over active
   + verified listings returning public-safe positions (`map`), summaries
   and `walkthrough`; imagery source per view (host pano at a pin, or a
   configured third-party provider for the area, or none). Nothing is
   generated client-side to fill a gap.
7. **A11y.** Pins are also a list (the nearby cards) so nothing is
   map-only. The segmented control is a `radiogroup`. Street pane canvas is
   `role="img"` with the source in its label (“Street imagery from
   {source}” or “Recorded by the host”).
8. **Hard stop.** No generated street fabric, “typical block”, or seed
   cottages. No pin that is not a real, active, verified `listings` row.
   Another host’s draft never appears. No Production seed walkthroughs.

---

## HM-D10 — Publish checklist (HM-08)

1. **Purpose.** Make “published” wait for “verified” and keep it distinct
   from payouts and from platform bookings. Primary CTA: **Publish this
   home** (enabled only when the scan row is Verified).
2. **Who.** Owner only.
3. **Layout.** In `ReviewStep` (wizard step 5) and, outside setup, as a
   `Card` at the top of the editor when the listing is not `active`:
   heading `hm.check.title`, a four-row `DataList` — Details · Photos ·
   Honesty scan · Payouts — each row a label, a `StatusPill`, and at most
   one inline link. Under the action row: `hm.check.publishBlocked` when
   disabled; `hm.check.platformClosed` as a quiet `Surface` note while
   `guestBookingsOpen` is false. The existing “Payouts are separate from
   publishing” surface stays and gains the sentence `hm.check.payouts.note`.
4. **States.** Scan row mirrors HM-D13’s twelve states with the same next
   action. Publish: enabled (verified) · disabled with reason · busy
   (“Publishing your home…”) · server refused (danger: the server’s
   message; the button stays disabled until the hub reports Verified) ·
   published (existing success message, plus “Guests can walk it once
   bookings open” is **not** said — bookings copy stays HM-D11’s).
5. **Copy.** §9.10.
6. **Server has decided.** `scan_verified_at` (or equivalent) on the
   listing; the publish PATCH refuses `status: active` without it (HM-08).
   Connect readiness from Stripe. `guestBookingsOpen` from public config.
7. **A11y.** Disabled Publish keeps its reason as `aria-describedby`. The
   checklist rows are a `DataList` so the pairing is programmatic.
8. **Hard stop.** Scan-verified never implies bookings on, payouts ready,
   or published. The checklist never shows “Ready for bookings”. Nothing
   here reads or writes `ALLOW_GUEST_BOOKINGS`.

---

## HM-D11 — Book path (HM-08 + existing kill-switch)

1. **Purpose.** Keep Soft Dist fail-closed, and after the flag flips,
   refuse a home without a verified walkthrough with a guest-safe reason.
   Primary CTA: unchanged (**Review price** / **Continue to payment**) when
   open; **Back to the home** when refused.
2. **Who.** Public up to Price & terms; signed in to create.
3. **Layout.** Unchanged. While `guestBookingsOpen` is false the page
   renders exactly what it does today: `BookingsClosed` and **Back to the
   home**, no calendar, no Payment Element. After the flag: if create
   returns the HM-08 not-verified error, the page shows a
   `StatusMessage tone="info"` with `hm.book.notVerified.*` in place of the
   step content and **Back to the home**. The quote step stays readable.
4. **States.** Existing states plus Not verified (post-flag only).
5. **Copy.** §9.11. `BOOKINGS_CLOSED_COPY` and
   `GUEST_BOOKINGS_CLOSED_MESSAGE` are unchanged.
6. **Server has decided.** `allowGuestBookings()` exact-`1` first, then the
   listing’s verified state, then everything create-booking already checks
   (active, capacity, ≥ 30 nights, host `acct_`, dates). The detail page
   also hides **Choose dates** for an active home whose `walkthrough` is
   null once HM-08 is enforced, so the refusal is rarely reached.
7. **A11y.** Unchanged; the new message is a polite status, not an alert.
8. **Hard stop.** Do not change the kill-switch to accept `"true"` /
   `"yes"`. Do not add a Book CTA that pretends Dist is live. Do not let a
   verified scan render **Choose dates** while `guestBookingsOpen` is false.

---

## HM-D12 — Honesty badge (HM-09)

1. **Purpose.** One recognizable mark for “geo-proven walkthrough”, in two
   sizes. No CTA of its own.
2. **Who.** Public (verified state). Host-only states never render for
   guests.
3. **Layout.**
   - *Mark glyph*: a 16 px pin-with-check drawn in the current `brand`
     colour, added to `src/components/Icons.tsx` as `ProvenIcon`. It is a
     glyph, not a stamp: no ribbon, no starburst, no gold.
   - *Compact* (`ListingCard`, walk chrome): `StatusPill tone="brand"`
     with the glyph and `hm.badge.short`. On the card it sits over the
     photo’s bottom-left corner on a paper chip, one per card, only when
     `walkthrough` is non-null.
   - *Full* (detail section, disclosure header): glyph + `hm.badge.full` in
     `text-sm font-semibold text-brand`, the three clauses separated by
     middle dots, wrapping to three lines on phone, then the metadata line.
   - *Colour*: brand ink on accent surface — the coded system’s
     verification pair (the handoff’s “brass” role; see the brief §2). No
     new colour is introduced for the badge in this phase.
4. **States.** Verified (public) · Processing (host-only pill,
   `tone="neutral"`, `hm.badge.processing`) · None (host-only, neutral,
   `hm.badge.none`) · Taken down (host-only, `tone="warning"`,
   `hm.scan.state.revoked`).
5. **Copy.** §9.1.
6. **Server has decided.** `walkthrough` non-null. The card never infers a
   badge from anything else (no photos count, no host tier).
7. **A11y.** Compact pill carries `hm.badge.a11y` as its `aria-label`; the
   glyph is `aria-hidden`. Full treatment is plain text and needs no label.
8. **Hard stop.** The mark is not a Trust Passport, not a legal seal, not a
   rating. Never on a home without a verified walkthrough. Never a
   “partially verified” or star variant.

---

## HM-D13 — Host homes list (HM-09)

1. **Purpose.** Show each home’s scan state and the single next thing to
   do. Primary CTA per row: the one next action.
2. **Who.** Owner only; the list is already owner-scoped by RLS.
3. **Layout.** In each existing row `Card`, under the status note
   (“Only you can see this home.” etc.), a line: `StatusPill` with
   `hm.scan.state.*` and one `ButtonLink size="sm" variant="secondary"`
   with `hm.scan.next.*`. The existing **Publish this home** button on a
   non-active row is replaced by that next action while the scan is not
   verified (publishing would be refused anyway); it returns when Verified.
4. **States → next action** (exactly one):

   | State | Pill | Next action → route |
   |---|---|---|
   | none, no pin | Needs the front door pin | Set the front door pin → editor, `#where` |
   | none, pin set | Not started | Scan from your phone → `/scan` |
   | capturing | Walk in progress | Continue on your phone → `/scan` |
   | uploaded, incomplete | Uploading | Resume upload → `/scan` |
   | uploaded, geofence pending | Checking location | — (no action) |
   | rejected | Not verified | See why → `/scan` |
   | reconstructing / queued | In the queue | See progress → `/scan` |
   | reconstructing / running | Building | See progress → `/scan` |
   | failed | Couldn’t build | See why → `/scan` |
   | needs_mask | Mark private areas | Mark private areas → `/scan/mask` |
   | verified | Verified | See it as a guest → `/listing/:id/walk` |
   | revoked | Taken down | See why → `/scan` |

   Tones: verified `brand`; rejected / failed / revoked `warning`;
   everything else `neutral`. Never `danger`.
5. **Copy.** §9.10.
6. **Server has decided.** The per-row scan state, delivered with
   `GET /api/listings/mine` (HM-09 extends `HostListing` with a `scan`
   summary) so the list does not fan out one request per home.
7. **A11y.** The pill text is the state; the link text is the action; the
   row heading remains the home’s name. No icon-only control.
8. **Hard stop.** Never another host’s scan state. Never a seed home shown
   as Verified. Never two next actions.

---

## Files this fill adds or changes

```
design/honesty-media/JOURNEYS-AND-COPY.md   # added — strings and journeys
design/honesty-media/SCREEN-INVENTORY.md    # this file, filled
design/honesty-media/DESIGN_BRIEF.md        # tightened; open decisions listed
design/honesty-media/README.md              # file table updated
```

Optional later, illustrative only: `design/honesty-media/prototype/`.

No application code changes while filling this inventory. When Nick marks
the design slice Ready, implementation follows BUILD-PLAN on an
implementation branch, one reviewable slice per PR, starting at HM-00.

Copyright 2026 Stead contributors.
