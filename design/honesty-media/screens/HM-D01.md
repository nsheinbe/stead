# HM-D01 — Capture (HM-01)

**Ticket:** HM-01 · **Route:** `/host/listings/:listingId/scan` ·
**Surface today:** none (new page). **Status:** specified.

The same route hosts the upload step ([HM-D03](HM-D03.md)); this file
covers everything up to **Finish the walk**.

## 1. Purpose and primary action

Record a phone walk through the home with continuous location samples,
so the server can later judge whether the walk happened at the home.
Primary action: **Start the walk** (after the pre-capture sheet), then
**Finish the walk**.

## 2. Who

Owner only. Signed-out → `SignInPrompt` with `intent="homeowner"` and
the exact return path. Signed-in non-owner → the editor's existing
"This home isn't yours to edit" treatment, with **View this home** and
**Your homes**.

## 3. Layout

**Phone (primary).** Focused shell (`focused`, `backTo` the editor,
`backLabel="Edit your home"`). One `h1`: "Scan {title}". Below it a
single column:

1. Pre-capture sheet as a `Dialog` (`size="md"`, focus trapped, Escape =
   **Not now**). Its content is [journeys §1.5](../JOURNEYS-AND-COPY.md#15-host-pre-capture-sheet).
2. Viewfinder: the live camera at full width, 3:4, with a 44 px safe
   margin from the bottom navigation (the bottom nav is hidden in a
   focused flow anyway).
3. Readout row under the viewfinder: elapsed time (tabular numerals),
   the location readout ([journeys §1.7](../JOURNEYS-AND-COPY.md#17-location-readout-capture)),
   and a text line for guidance ("Start outside the front door…").
4. Controls: **Start the walk** → becomes **Pause** / **Resume** and
   **Finish the walk**. Buttons are ≥ 48 px tall, full width, stacked.

**Desktop.** Same page renders a `Card` that says the scan needs a
phone: "Open this page on your phone to scan {title}." with the URL in a
read-only `TextInput` and **Copy link**. No camera is opened on a device
that reports no rear camera. Nothing else on the page.

## 4. States

| State | Behaviour |
|---|---|
| Loading | Skeleton for the header and a 3:4 block; sr-only "Loading this home" |
| Not found / not yours | As §2 |
| Coordinates unconfirmed | Instead of the viewfinder: `StatusMessage tone="warning" live={false}` "Confirm where the home is before you scan it." with **Confirm the home's location** → `/host/listings/:id#where`. The server refuses `POST …/scan` with the same 409 |
| Storage not configured | `StatusMessage tone="danger"` with the 503 message; no camera |
| No camera on device | Desktop treatment from §3 |
| Camera permission denied | `StatusMessage tone="warning"`: "We need the camera to film the walk. Allow camera access for this site, then try again." **Try again** re-requests |
| Location permission denied | Readout "Location: off" plus `StatusMessage tone="warning"`: "We need your phone's location while you walk. Allow location for this site, then try again." **Try again** |
| Waiting for a fix | Readout "Location: waiting for your phone"; **Start the walk** enabled (recording can start while the fix arrives; the bookend rule decides later) |
| Rough fix | Readout "Location: rough (about {m} m). Step outside or near a window for a better fix." Recording continues |
| Good fix | Readout "Location: good (about {m} m)" |
| Recording | Elapsed time counts; guidance line cycles through: "Slow and steady." / "Turn fully at each doorway." / "Film every room you rent." every 20 s. `Pause` freezes video and stops adding samples; a paused gap is recorded in the attestation |
| Backgrounded tab / `watchPosition` stopped | Recording auto-pauses; on return `StatusMessage tone="info"`: "We paused when the screen locked. Keep the screen on and tap Resume." |
| Bookend progress | A small text meter, not a seal: "Outdoor fix at the start: ✓ / not yet" and, once indoors for ≥ 60 s, "Outdoor fix at the end: not yet". These reflect only what the browser can see (accuracy within the gate near start / end); the verdict is the server's |
| Finish disabled | **Finish the walk** disabled until start bookend ✓ and indoor ≥ 60 s. Adjacent reason text: "We need a clear location fix outside the door at the start and the end." |
| Too long | At `scan_max_seconds` the recording stops with "That's the longest walk we can process. Finish outside now." **Finish the walk** enabled |
| Device out of storage | `MediaRecorder` error → `StatusMessage tone="danger"`: "Your phone ran out of space. Free some up and walk again." Nothing uploaded |
| Reduced motion | No animated recording indicator; the elapsed time is the indicator |

## 5. Copy

All from [journeys §1.5, §1.7, §1.9](../JOURNEYS-AND-COPY.md). Page
guidance lines:

- Before start: "Start outside the front door so your phone gets a clear
  fix, then walk in."
- Ending: "Finish outside the front door, then tap Finish the walk."
- Under the readout at all times: "Keep the screen on and this page
  open."

## 6. What the server must have decided already

- Listing exists, is the caller's, and has `coordinates_confirmed_at`.
- Storage is configured (503 otherwise).
- Thresholds (D07) are read from `app_config` at `POST …/scan` and
  snapshotted onto the scan row; the page reads them from
  `GET …/scan` for the on-device progress meter only.
- The browser never writes: verdicts, "at this home", `verified`,
  accuracy pass / fail. It records samples with `{ t, lat, lng, acc,
  source: "geolocation" }` and the recording clock. EXIF is not read on
  the device; the worker may extract it as supporting metadata only.

## 7. Accessibility

- `h1` "Scan {title}"; `RouteAnnouncer` moves focus to it.
- The pre-capture sheet is a `Dialog` with its title as the accessible
  name; **Start the walk** is the initial focus.
- Readout is `aria-live="polite"`, updated at most every 5 s so it does
  not chatter.
- Elapsed time is not live-announced; it is readable on demand.
- All controls ≥ 48 px; **Finish the walk** disabled state has visible
  adjacent reason text.
- The viewfinder `<video>` is `aria-hidden` with a text alternative "Live
  camera view" for the surrounding region.

## 8. Hard stops

- Never treat one EXIF tag, an IP lookup, or the listing's own
  coordinates as a location sample.
- Never draw the route on screen or store it in a public artifact.
- Never enable **Finish the walk** without a good outdoor fix at the
  start; never "estimate" a coordinate when the fix is absent.
- No filters, no beautify, no "improve lighting" on the viewfinder.

## 9. Tests

- Vitest: the sample buffer keeps `acc` and the recording clock; a paused
  gap is recorded; the on-device bookend meter never sets a pass flag
  that the server would read.
- Playwright (fake camera and geolocation): permission-denied states,
  the desktop "open on your phone" card, the coordinates-unconfirmed
  panel, and that **Finish the walk** stays disabled without a good
  start fix.
- Manual (report as done or blocked): iOS Safari and Android Chrome real
  capture, wake lock behaviour, indoor accuracy behaviour.

Copyright 2026 Stead contributors.
