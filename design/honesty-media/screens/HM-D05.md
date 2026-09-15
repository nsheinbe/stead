# HM-D05 — Rental vs private mask (HM-04)

**Ticket:** HM-04 · **Route:** `/host/listings/:listingId/scan/mask` ·
**Surface today:** none. **Status:** specified.

## 1. Purpose and primary action

Let the host decide what guests may walk through, as a recorded action,
before the walkthrough is verified. Primary action: **Send for
verification**.

## 2. Who

Owner only. Reachable only when the scan is `needs_mask` or `verified`
(re-mask, [journeys §6](../JOURNEYS-AND-COPY.md#6-journey-h3--re-mask-re-verify-revoke)).
Other states redirect to the status page with a polite status "The
scan isn't ready to mark yet."

## 3. Layout

**Phone (primary path — timeline).** Focused shell, `h1` "Mark private
rooms — {title}". Sections:

1. `Surface` intro (§5).
2. **Your walk**: a scrubber over the recording (the worker's frame
   strip, real frames) with a large current-frame `ListingPhoto` above
   it. Under it two buttons: **Mark as private from here** and, once a
   start is set, **…to here**. Each finished segment appears as a row:
   "Private: 1:20 – 1:45" with a thumbnail and **Remove**.
3. **Whole home** (shown only for `entire_home` and `apartment`, D11): a
   `Checkbox` "The whole walk is the rental — there's nothing private in
   it" which is mutually exclusive with segments (ticking it disables the
   segment tools with the reason "Untick this to mark private parts").
4. **What guests will see**: a text summary: "Guests will see {n} private
   parts removed ({total} seconds)" or "Guests will see the whole walk."
5. **Send for verification** (primary), **Save and finish later**
   (secondary).

**Desktop (refinement — 3D crop).** Same sections, plus, when the
compressed splat is available, a **Crop the 3D view** panel: the viewer
(read-only camera) with one **Keep this area** box the host can resize
with handles and arrow keys, and **Mark as private** boxes. This panel
is optional per D10 and hidden if the headless crop is not confirmed at
pin; the timeline path alone is enough to verify.

There is no "preview as guest" before verification; the crop is applied
by the worker, and the verified artifact is what guests get.

## 4. States

| State | Behaviour |
|---|---|
| Loading | Skeleton frame strip; sr-only "Loading your walk" |
| `needs_mask`, nothing marked | Summary "Guests will see the whole walk." **Send for verification** enabled only after either a segment exists or the whole-home box is ticked; adjacent reason otherwise: "Mark private parts, or confirm the whole walk is the rental." |
| `private_room` listing | Whole-home checkbox absent; hint "A private room listing always needs its private parts marked." |
| Segment overlaps | Merged automatically; the row shows the merged range |
| Everything marked private | Refuse with "You've marked the whole walk private. Keep at least the rental area." (server 400 mirrors) |
| Saved for later | State stays `needs_mask`; dashboard shows "Needs private rooms marked"; the page restores the segments from the server |
| Sending | Button busy "Sending…"; on success navigate to the status page with a polite "Sent for verification." The scan goes `needs_mask → reconstructing` (crop job) → `verified` |
| Re-mask on a verified scan | Banner `StatusMessage tone="info" live={false}`: "Your current walkthrough stays up until the new one is verified." Sending creates a new verification pass; the served artifact swaps only on `verified` |
| Crop job failed | Back to `needs_mask` with reason "We couldn't apply the crop. Try sending again, or mark the private parts on the timeline instead." |
| Save failed | `StatusMessage tone="danger"` with **Try again** |

## 5. Copy

- Intro: "Guests will walk through what you keep. Mark anything private
  — a bedroom, an office, a neighbour's door — and it's cut before
  anyone else sees the walkthrough."
- Buttons: **Mark as private from here** / **…to here** / **Remove** /
  **Keep this area** / **Mark as private** / **Confirm whole home** (the
  checkbox's action label in the summary) / **Send for verification** /
  **Save and finish later**.
- Never: Tidy, Clean up, Improve, Blur (blur is an edit, not a crop — if
  a future ticket wants blur it is a new policy decision).

## 6. What the server must have decided already

- The scan is `needs_mask` or `verified`; the listing type (for D11).
- The frame strip is worker-produced; segments are stored in seconds on
  the recording clock; the worker drops those frames and re-crops.
- `whole_home_confirmed_at` is written by the host's explicit action
  and is refused for `private_room`.
- `verified` is set only by the worker callback after the crop job; the
  browser never sets it.

## 7. Accessibility

- Scrubber is a labelled `<input type="range">` with the current time as
  its value text; segment rows are a list with per-row **Remove** named
  by range.
- Crop boxes are keyboard-operable (arrow keys move, Shift+arrows
  resize, Delete removes) with an instructions text near the panel.
- All state changes announced politely; sending success once.

## 8. Hard stops

- No inpainting, blur, "tidy this room", or any pixel edit other than
  crop / drop frames.
- No default whole-home: the confirmation is an action.
- Never overwrite a live verified artifact until the new one is verified.

## 9. Tests

- Vitest: segment merge, all-private refusal, `private_room` refusal.
- HTTP: mask upsert is owner-only; whole-home for `private_room` is 400;
  sending from a state other than `needs_mask` / `verified` is 409.
- RLS: another host cannot read or write the mask row.
- Playwright: timeline marking with a stubbed frame strip; whole-home
  path; re-mask banner.

Copyright 2026 Stead contributors.
