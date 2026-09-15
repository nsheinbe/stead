# HM-D04 — Reconstruction status (HM-03)

**Ticket:** HM-03 · **Route:** `/host/listings/:listingId/scan/status`
· **Surface today:** `src/pages/HostListingScanStatus.tsx` (HM-03).
**Status:** built, with the deviations in §10.

## 1. Purpose and primary action

Tell the host honestly where the scan is and what, if anything, they
can do. Primary action depends on state: **Check again** while
processing, **Mark private rooms** when ready, **Walk again** or **Try
processing again** when it failed.

## 2. Who

Owner only, as [HM-D01](HM-D01.md) §2.

## 3. Layout

**Desktop and phone (same, single column, narrow shell, hosting
workspace, `backTo` the editor).** `h1` "Scan progress — {title}".
Then:

1. A `Card` with a `StatusPill` (label from
   [journeys §1.6](../JOURNEYS-AND-COPY.md#16-host-scan-states)), the
   state sentence (§5), and the one next action.
2. A `DataList`: "Walk recorded" (captured date, listing-local), "Walk
   length" (mm:ss), "Location check" ("Confirmed" / "Couldn't confirm" +
   reason), "Processing started" (when known), "Last update" (server
   `updated_at`, listing-local date and time).
3. When `failed`: a "What the worker saw" section with up to 8 stills
   from the captured frames (`ListingPhoto`, 4:3), captioned "Frames from
   your walk. Nothing here is generated."
4. A quiet `Surface` "What happens next" explaining the mask step.

No progress bar for processing: the worker reports no percentage. If a
future worker reports an ETA, show it as "Usually about {n} minutes";
until then, no ETA.

## 4. States

| Scan state | Sentence | Next action |
|---|---|---|
| `uploaded` | "Queued for processing. This can take a while — often hours. We'll email you when it's done." | **Check again** (refetch) |
| `reconstructing` | "Processing your walk into a 3D walkthrough. This can take a while — often hours. We'll email you when it's done." | **Check again** |
| `needs_mask` | "Your walkthrough is ready for you to check. Mark anything private before it's verified." | **Mark private rooms** → mask |
| `verified` | "Verified {date}. Guests will see this walkthrough once the home is published." | **View the walkthrough** → `/listing/:id/walk` |
| `rejected` | Locked reason ([journeys §1.8](../JOURNEYS-AND-COPY.md#18-refusals-and-errors)) | **Walk again** (+ **Check the home's location** for a mismatch) |
| `failed` | "Processing didn't finish." + locked reason | **Try processing again** (idempotent retry, disabled after 3 attempts with "We've tried three times. Walk again, slower and with more overlap between rooms.") and **Walk again** |
| `capturing` | "The walk hasn't finished uploading." | **Finish uploading** → capture |
| none | "This home hasn't been scanned yet." | **Scan this home** |
| Loading / error | Skeleton + sr-only status; `StatusMessage tone="danger"` "We couldn't load the scan." with **Try again** |

`Check again` refetches once and announces the result in a polite
status ("Still processing." / "Ready for you to check."). The page also
refetches on window focus. No interval polling.

Retry is a `POST …/retry`; the button is busy "Queuing…" and the state
returns to `reconstructing` only from the server response.

## 5. Copy

Sentences in §4; email subjects (D14), all from the same copy module:

- `needs_mask`: "Your walkthrough of {title} is ready to check"
- `verified`: "{title} is verified"
- `rejected`: "We couldn't confirm the location for {title}"
- `failed`: "We couldn't process the walk for {title}"

Email bodies restate the sentence and link to this page. No marketing.

## 6. What the server must have decided already

- State, reason, attempt count, stills (worker-selected real frames),
  and timestamps come from `GET …/scan`. The page never infers state
  from time elapsed.
- The worker sets state through the `SECURITY DEFINER` function via the
  D03 callback; a stale attempt is refused.
- Stills for a `failed` scan are frames from the upload, keyed under the
  owner-only prefix and served through short-lived signed URLs.

## 7. Accessibility

- `h1` as above; pill text is the status.
- The result of **Check again** is announced once, politely.
- Stills have `alt=""` with the caption carrying the meaning.
- Time is "d MMM yyyy, h:mm a" in the listing zone with the zone named.

## 8. Hard stops

- No "preview while we wait", no partial or generated splat.
- No provider or model branding (no Luma, no "powered by").
- SuperSplat is never mentioned to hosts; if a runbook must, it is as
  "the crop / compress step".
- No fake ETA.

## 9. Tests

- Vitest: state → sentence / action mapping is total (every `ScanState`
  has one).
- HTTP: retry refuses when not `failed`; after 3 attempts refuses with
  the locked message.
- Playwright: each state renders the right action with a stubbed scan
  endpoint.

## 10. As built (HM-03)

- **`needs_mask` has no link yet.** HM-04 (the mask page) is not built, so
  the card shows the sentence plus "Marking private rooms isn't ready on
  Stead yet. Nothing from this walk is public until you have." instead of
  a dead **Mark private rooms** link. The verb lands with HM-04.
- **`verified` links to the listing, not `/walk`.** No function can set
  `verified` before HM-04/05, so the state is unreachable today; the
  action is **View this home** → `/listing/:id` until HM-05 adds the
  walkthrough route.
- **A "Processing attempts" row** (`{attempt} of {maxAttempts}`) joins
  the `DataList` once processing has been tried; the cap is
  `scan_max_attempts` (app_config, default 3), so the exhausted message
  reads "We've tried 3 times…" from the number, not a hard-coded "three".
- **Stills** load only when the worker recorded any; otherwise the page
  says "The worker didn't save any frames from this walk." Frames are
  keyed under the scan prefix and served through 300-second signed URLs
  (`GET …/stills`).
- **Refetch on window focus** is enabled for this query only (the app
  default is off); **Check again** refetches once and announces
  "Still processing." or "Ready for you to check." politely.
- Retry is `POST …/scans/:scanId/retry`; the button is busy "Queuing…"
  and disabled once `canRetry` is false. The state shown afterwards is the
  server's response, never assumed.

Copyright 2026 Stead contributors.
