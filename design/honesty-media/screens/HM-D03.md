# HM-D03 — Upload (HM-02)

**Ticket:** HM-02 · **Route:** `/host/listings/:listingId/scan` (upload
step, same page as [HM-D01](HM-D01.md)) · **Surface today:** none.
**Status:** specified.

## 1. Purpose and primary action

Move the recording, the location record and the camera notes to the
scan's own object prefix, then tell the server the package is whole.
Primary action: none while uploading (it is automatic after **Finish
the walk**); **Finish uploading** when resuming.

## 2. Who

Owner only, as [HM-D01](HM-D01.md).

## 3. Layout

**Phone.** After **Finish the walk** the viewfinder is replaced by an
upload `Card`:

1. `h2` "Uploading your walk"
2. Three rows, each with a label, a `Progress`-style bar and a status
   word: "Video", "Location record", "Camera notes". Sizes in MB with
   tabular numerals.
3. A line "Keep this page open until the upload finishes." and, on
   completion, the receipt (§4).
4. On the receipt: **Check progress** (primary) → status page.

**Desktop.** Not reachable (capture is phone-only); a resumed upload
from a desktop shows "Finish this upload on the phone that recorded the
walk." because the recording lives on that device.

## 4. States

| State | Behaviour |
|---|---|
| Presigning | Row status "Preparing…" |
| Uploading | Bar advances per completed part; status "12 MB of 210 MB" |
| Part failed | Row status "Didn't finish"; the page retries that part up to 3 times with backoff, then shows `StatusMessage tone="warning"` "The upload lost connection." with **Finish uploading** (resumes from the last completed part) |
| Interrupted (page closed) | On return to the route while the scan is `capturing` with parts recorded: the page opens on this step with the rows' saved progress and **Finish uploading**. If the recording is gone from the device, the only option is **Walk again** |
| Completing | After all parts: status "Checking the package…" (server validates sizes, types, prefix, that every part exists) |
| Receipt: queued | `StatusMessage tone="success"` "Uploaded. Location confirmed — queued for processing." **Check progress** |
| Receipt: rejected | `StatusMessage tone="warning"` "Uploaded, but we couldn't confirm the location." followed by the locked reason ([journeys §1.8](../JOURNEYS-AND-COPY.md#18-refusals-and-errors)). **Walk again** and, for a mismatch, **Check the home's location** |
| Receipt: incomplete | 409 "Some of the walk didn't finish uploading. Finish uploading, then try again." with **Finish uploading** |
| Too large | Completion refuses over the cap: "This walk is longer than we can process ({minutes} min). Walk again and keep it under {max} minutes." |
| No receipt yet | While the completion call is in flight the page says "Checking the package…" and never "verified" or "queued" from its own state |

## 5. Copy

- `h2` "Uploading your walk"
- Rows: "Video" / "Location record" / "Camera notes"
- "Keep this page open until the upload finishes."
- Receipts as §4; strings from journeys §1.8.

## 6. What the server must have decided already

- Keys are built server-side under
  `listings/:listingId/scans/:scanId/{video,attestation,notes}/…`;
  content type is signed; `POST …/uploads` refuses a kind or type off
  the allowlist (`video/mp4`, `video/webm`, `video/quicktime`,
  `application/json`).
- Multipart per D06; part URLs expire in 300 s and are re-requested per
  part.
- `POST …/complete` reads object metadata from the bucket (size, type),
  refuses a foreign prefix exactly like `POST /:id/photos` does today,
  parses the attestation, **computes the geofence verdict** against
  `listings.lat` / `lng` and the snapshotted thresholds, writes
  `scan_geo_samples`, and sets `uploaded` or `rejected`. The verdict
  never comes from the client JSON.
- The raw prefix is owner-only; no public URL is ever built for it.

## 7. Accessibility

- Each row's bar has `aria-valuenow` / `aria-valuemax` and the row
  label; the status word is text.
- The receipt is a live `StatusMessage` (success or warning); the
  in-flight message is `role="status"`.
- **Finish uploading** is a real button with the same size rules.

## 8. Hard stops

- Never proxy bytes through the Hono function.
- Never display "verified", "queued" or a verdict from browser state.
- Never store a client-supplied verdict, fence result or "at home" flag
  as authoritative.
- Never let one listing's completion attach objects from another prefix.

## 9. Tests

- `tests/storage.test.ts`: scan keys, allowlist, part numbering.
- HTTP: completion refuses a missing part, a foreign prefix, an
  oversized object; writes samples; verdict cases from the geofence
  test map.
- RLS: another host cannot read this scan's row or samples.
- Playwright: interrupted-upload resume UI with a stubbed bucket.

Copyright 2026 Stead contributors.
