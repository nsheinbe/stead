# HM-D08 — Approach and door tether (HM-06)

**Ticket:** HM-06 · **Route:** `/listing/:id` (approach section) and the
walk at `/listing/:id/walk` (tether) · **Surface today:** none.
**Status:** specified; depends on D08 (tiles) and D09 (precision).

## 1. Purpose and primary action

Show the real approach to the door, filmed by the host, tethered to the
indoor walk, with a map pin at the precision the host allowed. Primary
actions: **Step outside** (inside the walk) and **Go inside** (in the
approach).

## 2. Who

Same as [HM-D06/D07](HM-D06-D07.md): public for verified active
listings, owner preview otherwise. The approach is additionally gated by
the host's visibility choice (D09): "everyone" or "after a stay is
confirmed". With the default, a guest without a confirmed stay sees the
rounded pin and no approach footage; a guest whose booking on this
listing is `confirmed` or later sees the door.

## 3. Layout

### Detail section

Under "Walk through this home", a `h2` "The street" section:

**Desktop.** Left: a MapLibre map (16:10) with one pin. Right: the
approach poster still with **Step outside** (opens the walk route at
the door pose), the imagery label (§5), and the precision note.

**Phone.** Map (4:3) stacked above the poster and button.

If the host has no approach footage (a scan verified before HM-06, or
the outdoor bookends were too short to build one) the right column
shows only the imagery-none sentence and the map.

### Tether inside the walk

Inside `/listing/:id/walk`, when the guest's camera is within the
worker-marked door volume, **Step outside** becomes enabled in the
bottom-right chrome (it is visible but disabled elsewhere with the
tooltip-as-text "Walk to the front door to step outside"). Pressing it
crossfades — or, under reduced motion, cuts — to the approach view at
the door pose. The approach view has **Go inside** in the same
position, returning to the same indoor door pose. The badge and
disclosure stay in the chrome in both views; the approach view's badge
gets the suffix "· Approach filmed by the host".

## 4. States

| State | Behaviour |
|---|---|
| Tiles unavailable | The map area shows `StatusMessage tone="info" live={false}` "The map couldn't load." and the pin's place text ("{city}, {region}"). Never a blank grey box |
| Approach exists, public | Poster + **Step outside** |
| Approach exists, confirmed-stay only, viewer has none | Poster hidden; text "The host shows the approach to guests with a confirmed stay." plus the rounded pin |
| Approach exists, viewer is the owner | Always visible, with the preview banner |
| No approach | "No street imagery here yet. We do not draw what nobody filmed." Map still shows the pin |
| Third-party imagery available (HM-07 layer) and host footage absent | A separate, labelled panel "Street imagery from {provider}." with its own viewer; it is **not** placed at the door pose and **not** tethered to the indoor walk |
| Reduced motion | Cut instead of crossfade; approach view is stills-first exactly like the indoor walk |
| No WebGL | Approach shown as its stills sequence ("Stills from the host's approach") |

## 5. Copy

- `h2`: "The street"
- Imagery labels: `imagery.host`, `imagery.thirdParty`, `imagery.none`
  (locked).
- Precision note under the map: "Pin shown to the nearest {n} m until a
  stay is confirmed." (default) or "Pin shows the front door." (host
  chose everyone).
- Host setting (in the editor "Where it is", HM-06 adds it): a `Select`
  "Who can see the approach and exact pin" with "Guests with a confirmed
  stay (default)" / "Everyone".

## 6. What the server must have decided already

- Whether the viewer may see the exact pin and approach
  (`hasApproach` and a `pinPrecisionM` on the walkthrough response
  computed from the host setting and the viewer's bookings).
- The door pose and door volume, marked by the worker from the outdoor
  bookends; the browser reads them, never computes them.
- Pin coordinates are rounded **server-side** before they leave; the
  exact `lat` / `lng` never reach a non-entitled client.

## 7. Accessibility

- Map has an accessible name "Map showing the area of {title}" and the
  pin has text; keyboard users get the place text and the same buttons.
- **Step outside** disabled state has adjacent text.
- View change is announced once: "Outside, at the front door." /
  "Inside, at the front door."

## 8. Hard stops

- Mapillary is never the only outdoor layer; no street vendor inside
  the indoor viewer.
- No invented building, façade, or "typical street" when the host
  filmed nothing.
- No Google Street View product mark or SDK dependency.
- No exact coordinates to a viewer the host did not allow.

## 9. Tests

- HTTP: precision and `hasApproach` matrix (owner, confirmed guest,
  stranger, setting everyone / confirmed-only); rounding happens
  server-side.
- Playwright: tiles-unavailable panel; approach-hidden text; tether
  buttons enable / disable with a stubbed door volume.
- Manual: the crossfade and door alignment on a WebGL device.

Copyright 2026 Stead contributors.
