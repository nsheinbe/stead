# Honesty media — design brief

**Status:** Specified. The design slice is **Ready for Nick’s review**:
[`SCREEN-INVENTORY.md`](SCREEN-INVENTORY.md) is filled for HM-D00 … HM-D13
and [`JOURNEYS-AND-COPY.md`](JOURNEYS-AND-COPY.md) holds every journey,
disclosure and string. Not shipped UI. Not a claim that walkthroughs exist on
Production. Three product decisions are listed in §9 for Nick to confirm or
change before implementation starts.

**Companion tickets:** [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md)
(HM-00 … HM-09).

**Immutable design truth** (do not edit): `/design/Stead.dc.html`,
`/design/DESIGN_HANDOFF.md`. New specs live only in this folder.

Copyright 2026 Stead contributors.

---

## 1. Job to be done

A guest should walk a **real** Stead home and a **real** block — not a
brochure render. A host should prove the walk happened **at this
listing** before the home can be bookable.

Soft Dist launch criterion: required geo-proven property scan for every
host before a home is bookable. Platform bookings stay off until Nick
sets `ALLOW_GUEST_BOOKINGS=1` after this ships and is required.

### Host

Set the front door pin → read the honesty sheet → walk-scan on a phone,
starting and finishing outside the front door → upload → server checks the
location record → worker builds the walkthrough → mark private areas (or
confirm whole home) → verified → publish. Journey H1 in
`JOURNEYS-AND-COPY.md` §2.

### Guest

- Walk neighborhoods in cities they are searching (Journey G2).
- Walk through geo-proven Stead rentals (Journey G1).
- Discover nearby Stead rentals **in-world** (spatial query — no
  invented buildings).

### Reconstruction (honesty)

Allowed: stitch, stabilize, compress, crop, cleanup (noise and floaters,
never filling the gap).

Forbidden: beautify, generative fill, invented rooms, invented
furniture, invented façades. The full ban list for UI verbs and model
features is `JOURNEYS-AND-COPY.md` §10.

Provenance (geofence + optional C2PA content credentials) is a
**signal**, not courtroom GPS. The copy says “a strong signal, not a
guarantee” and nothing stronger.

---

## 2. Visual system (reuse, do not replace)

Two sources describe Stead’s palette and they no longer agree, so this
section says which one honesty media follows and how the two map.

- `/design/DESIGN_HANDOFF.md` (immutable): paper / ink / spruce / brass /
  linen / claim, Ibarra Real Nueva for display.
- The coded **design system v1** (`tailwind.config.js`,
  `redesign-handoff/design/01-DESIGN-SYSTEM.md`, merged to `main`):
  semantic roles — canvas, surface, accent surface, ink, secondary ink,
  brand, divider, control, focus, danger, warning. The serif display face
  is retired; Hanken Grotesk carries every size. The old names survive
  only as transitional aliases the config says not to add new uses of.

Honesty media is built in the **coded system**. The handoff’s roles map
like this:

| Handoff role | Coded role (class) | Honesty-media use |
|---|---|---|
| paper | `canvas` / `bg-surface` | Page, viewer chrome, upload card |
| ink | `text-ink` / `text-ink-secondary` | Body, prompts, location line, private-area hatch |
| spruce / spruce-deep | `bg-brand` / `hover:bg-brand-hover` | Primary actions: Start the walk, Finish and verify, Walk through this home |
| brass (verification marks) | `text-brand` on `bg-surface-accent` — the pair `StatusPill tone="brand"` already uses | The honesty mark and compact badge. Brass meant “the verification accent”; in the coded system that accent is this pair. No gold is reintroduced. |
| linen / linen-tint | `bg-surface` / `border-divider` | Panels, checklist rows, tool rail |
| claim (`#B3402A`) | `danger` | Claim and dispute states **only**. Never for a scan that was not verified or a build that failed — those are `info`/`warning` with calm copy. |

Rules that carry over unchanged:

- Tabular numerals (`.money`) on every figure: elapsed time, upload
  progress, accuracy in meters, byte counts. Honesty media never invents
  prices; stay totals still come from the server.
- 12 px card radius, 16 px surface radius (the coded values), soft single
  shadows. No “security hologram” chrome, no ribbon, no starburst, nothing
  that implies a legal document.
- Photography is the host’s recorded frames. No picsum, no stock, no
  render stands in for a room.

### The honesty mark

A 16 px pin-with-check glyph (`ProvenIcon`, proposed for
`src/components/Icons.tsx`), always beside text, never alone. Compact:
`StatusPill tone="brand"` with `hm.badge.short`. Full: glyph and
`hm.badge.full` in brand text, then the captured date and scope line.
Specified in `SCREEN-INVENTORY.md` HM-D12.

### Scan-state colours

| State | Tone | Why |
|---|---|---|
| Verified | `brand` pill, `success` message | The one earned state |
| Not started · in progress · queued · building · mark private areas | `neutral` pill, `info` message | Normal work |
| Not verified · couldn’t build · taken down | `warning` pill, `info` message with the fix | Needs the host, not an emergency |
| Upload stopped · permission blocks recording · server refused publish | `danger` message (`role="alert"`) | Work at risk or an action refused |

---

## 3. Voice

Plain, confident, lightly wry. Buttons say what they do (“Start the walk”,
“Mark private areas”, “Finish and verify”, “Walk through this home”,
“Go outside”) — not “Submit”, not “Enhance”.

Use: geo-proven walkthrough, honesty scan, walk, private areas, rental
areas, front door pin, stitched / steadied / compressed, community-owned,
open source, Trust Passport, independent arbitration.

Never: blockchain, crypto, wallet, web3, DAO, smart contract, on-chain,
gas, beautify, enhance (as a reconstruction verb), “AI completed this
room”, “live GPS courtroom proof”, and the full list in
`JOURNEYS-AND-COPY.md` §10.

Copyright line on surfaces this phase touches: **Copyright 2026 Stead
contributors.**

**Badge — locked by HM-00** (`JOURNEYS-AND-COPY.md` §9.1):

> Geo-proven walkthrough · Captured by the host · Stitched, not invented

Compact form: **Geo-proven walkthrough**. Metadata: **Captured {date}**
(listing-local) and **Whole home** or **Rental areas only**.

---

## 4. Journeys

Written in [`JOURNEYS-AND-COPY.md`](JOURNEYS-AND-COPY.md):

1. **H1 — Host, first honesty scan** (§2), with the GPS-poor and
   geofence-fail branches.
2. **H2 — Host, publish blocked** (§3): scan missing or failed; Book /
   Reserve stays “Not open for bookings yet” while the platform flag is
   off.
3. **H3 — Host, change or take down a walkthrough** (§4).
4. **G1 — Guest, walk a home** (§5): badge → enter → reduced-motion /
   no-WebGL fallbacks → door tether to the approach.
5. **G2 — Guest, neighborhood walk** (§6): real pins only; an empty city
   is empty.

---

## 5. Product facts the UI must not collapse

| Fact | Who sets it | Guest-visible when |
|---|---|---|
| Draft vs `active` vs `paused` | Host + server | Catalog rules unchanged |
| Scan-verified | Server / worker after geofence + mask | Badge + walk CTA |
| Payout-ready (Connect) | Stripe | Host checklist only |
| Platform bookings on | Nick, `ALLOW_GUEST_BOOKINGS=1` | Book / Reserve enabled |

A verified scan does not turn bookings on. A published home without a
scan is not bookable once HM-08 ships. The publish checklist (HM-D10)
shows the four facts as four rows.

Stays remain **≥ 30 nights**. Connect remains **host merchant of
record**. Stead remains **open source**, not a protocol product.

---

## 6. Motion and access

- Prefer host-captured stills when `prefers-reduced-motion`; the 3D walk
  is an opt-in and then moves only on input, with no easing or auto-orbit.
- Do not autoplay a moving camera. The approach pano does not auto-rotate.
- Keyboard: enter / leave the walk (Esc), move (arrows / WASD), look
  (Shift + arrows), draw and adjust mask boxes by numeric inputs, dismiss
  errors. `?` opens the controls help.
- Touch targets ≥ 44 × 44 CSS px (the kit uses 48). Phone-first for the
  pre-capture sheet, capture and upload (HM-D00, D01, D03); the mask step
  works on both with a top-down default on phone.
- Desktop-first for the neighborhood map chrome (HM-D09), with a usable
  phone walk (street pane + Map/Street control).
- Missing WebGL: real captured stills plus “This walkthrough needs a newer
  browser.” Never a generated stand-in.
- Recording keeps the screen awake (Wake Lock) and says so once.
- Live regions: location line and upload progress are polite and
  throttled; only lost work or a refused action is an alert.

---

## 7. Out of scope for this folder

- Editing `/design` truth files listed above.
- Visual Rails branding or “powered by” marks.
- Seed / picsum homes presented as geo-proven.
- Payment, escrow, or PAY-02 checkout redesign.
- Mapillary as the only outdoor look.
- A non-visual mask editor (HM-D05 lists it as a known gap for HM-04).
- Multi-session scans merged into one walkthrough (one walk per
  verification; a large home is a longer walk within `maxWalkMinutes`).

---

## 8. Design-fill checklist

- [x] Lock badge + disclosure strings — `JOURNEYS-AND-COPY.md` §8, §9.1.
- [x] Specify capture permission and GPS-poor UI with no invented fix —
      `SCREEN-INVENTORY.md` HM-D01; `JOURNEYS-AND-COPY.md` §2 branches,
      §9.3.
- [x] Specify mask UI without an “enhance” control, even disabled —
      HM-D05; §9.7; ban list §10.
- [x] Specify viewer fallbacks (motion, WebGL, failed job) — HM-D04,
      HM-D07; §9.6, §9.8.
- [x] Specify empty neighborhood with no fake houses — HM-D09; §9.9.
- [x] Confirm Book / Reserve copy still fail-closed until Nick flips the
      flag — HM-D11; §9.11 (existing strings unchanged).

The design slice is Ready. Implementation waits for Nick’s go-ahead and
starts at HM-00 on an implementation branch.

---

## 9. Open decisions for Nick

Each has a recommended default already written into the specs. Changing
one changes copy in `JOURNEYS-AND-COPY.md` and one or two rows in
`SCREEN-INVENTORY.md`; nothing else.

1. **Mask change after verification takes the walkthrough down.**
   Recommended (specified): changing private boxes on a verified scan
   makes the guest walk unavailable and the home unbookable until the
   worker re-applies the crop and the server re-verifies — privacy wins.
   Alternative: keep the old walkthrough live until the new one verifies —
   continuity wins, but something the host now wants hidden stays visible
   in the meantime. (A re-*scan* keeps the old walk live, since nothing new
   is being hidden.)
2. **Default map precision is “neighborhood”.** Recommended (specified):
   guests see a stable ~area circle, not the door; the exact spot is
   shared after a confirmed stay, or publicly if the host opts in. This is
   what makes an approach pano and in-world discovery compatible with the
   listing not showing its street address today. Alternative: exact pin by
   default, with the address stated as already implied by the façade.
3. **The honesty mark uses the coded brand/accent pair, not a new gold.**
   Recommended (specified): no new colour this phase; the mark is glyph +
   text in the system’s existing verification pair. Alternative: add one
   semantic role (say `provenance`) valued at the handoff’s brass
   `#B58B3E` / `#8C6A2C` / `#DDB672` in the implementation PR — a
   design-system change the redesign deliberately walked away from
   (“remove decorative gold stamps”), so it should be Nick’s call, not the
   ticket’s.

Copyright 2026 Stead contributors.
