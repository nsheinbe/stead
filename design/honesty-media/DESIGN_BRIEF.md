# Honesty media — design brief

**Status:** Direction, filled. The screens this brief framed are
specified in [`SCREEN-INVENTORY.md`](SCREEN-INVENTORY.md) and
`screens/`, the copy is locked in
[`JOURNEYS-AND-COPY.md`](JOURNEYS-AND-COPY.md), and every open product or
infrastructure decision is recorded in [`DECISIONS.md`](DECISIONS.md).
Not shipped UI. Not a claim that walkthroughs exist on Production.

**Companion tickets:** [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md)
(HM-00 … HM-09).

**Immutable design truth** (do not edit): `/design/Stead.dc.html`,
`/design/DESIGN_HANDOFF.md`. New specs live only in this folder. Note
that the app as shipped follows the 2026-09 redesign
(`redesign-handoff/design/01-DESIGN-SYSTEM.md`, `tailwind.config.js`),
which supersedes those files visually; §2 below says how this brief
reconciles the two.

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

Walk-scan on a phone → geo-prove at listing coordinates → mark rental
area(s) vs private (or confirm whole-home) → publish a 3D indoor
walkthrough tethered to a Street View–**style** outdoor approach.

### Guest

- Walk neighborhoods in cities they are searching.
- Walk through geo-proven Stead rentals.
- Discover nearby Stead rentals **in-world** (spatial query — no
  invented buildings).

### Reconstruction (honesty)

Allowed: stitch, stabilize, compress, crop, cleanup.

Forbidden: beautify, generative fill, invented rooms, invented
furniture, invented façades.

Provenance (geofence + optional C2PA content credentials) is a
**signal**, not courtroom GPS.

---

## 2. Visual system (reuse, do not replace)

The app in code uses the redesign's semantic palette, not the original
`/design` names. `tailwind.config.js` keeps `paper` / `spruce` / `brass`
/ `linen` / `claim` only as transitional aliases and says "Do not add new
uses of an alias". Honesty media therefore specifies the semantic
values, and maps the original intent onto them
([DECISIONS D01 / D02](DECISIONS.md#2-open-decisions)):

| Original intent | Shipped value | Honesty-media use |
|---|---|---|
| paper | canvas `#FFFFFF` / surface `#F5F7F6` | Page ground, viewer chrome strip, panels |
| ink | ink `#17201B` / secondary `#53625A` | Body, controls, metadata |
| spruce / spruce-deep | brand `#1E4034` / hover `#16332A` | Primary actions ("Start the walk", "Walk through this home") |
| brass (honesty / geo-proven marks) | brand ink on accent surface `#E9F1EC` — the same treatment as `StatusPill tone="brand"` | The honesty badge and "Verified {date}" only — never decoration on every card. If Nick wants a distinct verification hue it becomes a new semantic token, not a revival of brass |
| linen / linen-tint | surface `#F5F7F6` / divider `#DCE2DE` | Grouped content, dividers |
| claim | danger `#A73528` / `#FAEBE8` | Claim and dispute states, and load / save failures like the rest of the app. **Never** for "scan failed", "GPS rough" or "couldn't confirm" — those are warning `#78520B` / `#FFF1DD` or plain ink |

- Type: Hanken Grotesk for everything, per the shipped system; the
  serif display face is retired and is not reintroduced for this
  feature.
- Tabular numerals on money, sizes, and times. Honesty media does not
  invent prices; stay totals still come from the server.
- 12 px cards, 16 px grouped surfaces, 8 px controls, soft single
  shadows only on overlays. No ornamental "security hologram" chrome
  that implies a legal document.

---

## 3. Voice

Plain, confident, lightly wry. Buttons say what they do ("Start the
walk", "Mark private rooms", "Try processing again") — not "Submit" or
"Enhance". The full allowed and banned verb lists are in
[journeys §1.9](JOURNEYS-AND-COPY.md#19-buttons-and-verbs).

Use: geo-proven walkthrough, honesty scan, community-owned, open source,
Trust Passport, independent arbitration.

Never: blockchain, crypto, wallet, token, web3, DAO, smart contract,
on-chain, gas, beautify, enhance (as a reconstruction verb), "AI
completed this room," "live GPS courtroom proof."

Copyright line on surfaces this phase touches: **Copyright 2026 Stead
contributors.**

Locked badge (HM-00 commits this string to the app):

> Geo-proven walkthrough · Captured by the host · Stitched, not invented

Short form for cards: **Geo-proven walkthrough**. Every other locked
string is in [journeys §1](JOURNEYS-AND-COPY.md#1-locked-strings-hm-00).

---

## 4. Journeys

Written in [`JOURNEYS-AND-COPY.md`](JOURNEYS-AND-COPY.md):

1. **Host, first scan** — §2, with the GPS-poor, geofence-fail,
   permission-denied, interrupted-upload and failed-reconstruction
   branches.
2. **Host, publish blocked** — §3.
3. **Guest, listing walk** — §4, including reduced motion, no WebGL and
   the door tether.
4. **Guest, neighbourhood** — §5, including the empty city.
5. **Re-mask, re-verify, revoke** — §6 (added; the brief did not ask for
   it but the state machine needs it).

---

## 5. Product facts the UI must not collapse

| Fact | Who sets it | Guest-visible when |
|---|---|---|
| Draft vs `active` vs `paused` | Host + server (`app.set_listing_status`, D04) | Catalog rules unchanged |
| Front-door location confirmed | Host, recorded action (HM-D02) | Never directly; pin precision per D09 |
| Scan-verified | Server / worker after geo + mask | Badge + walk CTA |
| Payout-ready (Connect) | Stripe | Host checklist only |
| Platform bookings on | Nick, `ALLOW_GUEST_BOOKINGS=1` | Book / Reserve enabled |

A verified scan does not turn bookings on. A published home without a
scan is not bookable once HM-08 ships — and, per D04 / D12, cannot be
published or stay published without one.

Stays remain **≥ 30 nights**. Connect remains **host merchant of
record**. Stead remains **open source**, not a protocol product.

---

## 6. Motion and access

- Prefer host-captured stills when `prefers-reduced-motion`.
- Do not autoplay a moving camera.
- Keyboard: enter / leave walk, mark mask regions, dismiss errors.
- Touch targets ≥ 44×44 CSS px. Phone-first for capture (HM-01, HM-04).
- Desktop-first for neighborhood map chrome (HM-07), with a usable
  phone walk.
- Missing WebGL: real captured stills + explanation, never a generated
  stand-in splat.

Each screen spec's §7 applies these to its controls.

---

## 7. Out of scope for this folder

- Editing `/design` truth files listed above.
- Visual Rails branding or "powered by" marks.
- Seed / picsum homes presented as geo-proven.
- Payment, escrow, or PAY-02 checkout redesign.
- Mapillary as the only outdoor look.
- Changing `CLAUDE.md`'s token table (stale for the same reason as §2;
  flagged in the return handoff, not edited here).

---

## 8. Design completion checklist

- [x] Lock badge + disclosure strings — [journeys §1](JOURNEYS-AND-COPY.md#1-locked-strings-hm-00).
- [x] Specify capture permission and GPS-poor UI (no invented fix) —
      [HM-D01](screens/HM-D01.md), [HM-D02](screens/HM-D02.md).
- [x] Specify mask UI without an "enhance" control — even disabled —
      [HM-D05](screens/HM-D05.md).
- [x] Specify viewer fallbacks (motion, WebGL, failed job) —
      [HM-D06/D07](screens/HM-D06-D07.md), [HM-D04](screens/HM-D04.md).
- [x] Specify empty neighborhood (no fake houses) — [HM-D09](screens/HM-D09.md).
- [x] Confirm Book / Reserve copy still fail-closed until Nick flips
      the flag — [HM-D11](screens/HM-D11.md).
- [x] Record unresolved decisions — [DECISIONS §2](DECISIONS.md#2-open-decisions).

The design slice is Ready for review. Implementation starts at HM-00 on
a dedicated branch off then-current `main` only when Nick asks.

Copyright 2026 Stead contributors.
