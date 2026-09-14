# Honesty media — design brief

**Status:** Direction and inventory for Claude Code to flesh out. Not
shipped UI. Not a claim that walkthroughs exist on Production.

**Companion tickets:** [`docs/honesty-media/BUILD-PLAN.md`](../../docs/honesty-media/BUILD-PLAN.md)
(HM-00 … HM-09). Screen list:
[`SCREEN-INVENTORY.md`](SCREEN-INVENTORY.md).

**Immutable design truth** (do not edit): `/design/Stead.dc.html`,
`/design/DESIGN_HANDOFF.md`. Reuse those tokens. New specs live only in
this folder.

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

From `/design/DESIGN_HANDOFF.md`:

| Token | Hex | Honesty-media use |
|---|---|---|
| paper | `#FBFAF7` | Surfaces, viewer chrome |
| ink | `#17201B` | Body, controls |
| spruce / spruce-deep | `#1E4034` / `#16332A` | Primary actions (“Start scan”, “Enter the home”) |
| brass / brass-light / brass-deep | `#B58B3E` / `#DDB672` / `#8C6A2C` | Honesty / geo-proven marks only — not decoration on every card |
| linen / linen-tint | `#EFE9DF` / `#E8E0CE` | Panels, dividers |
| claim | `#B3402A` | Claim and dispute states **only**. Scan failed / GPS poor use ink + linen, not claim red. |

- Display headlines: Ibarra Real Nueva. UI: Hanken Grotesk.
- Tabular numerals on money — honesty media does not invent prices;
  stay totals still come from the server.
- 16px card radius, soft single shadows. No ornamental “security
  hologram” chrome that implies a legal document.

---

## 3. Voice

Plain, confident, lightly wry. Buttons say what they do (“Start walk
scan”, “Mark private rooms”, “Retry reconstruction”) — not “Submit” or
“Enhance.”

Use: geo-proven walkthrough, honesty scan, community-owned, open source,
Trust Passport, independent arbitration.

Never: blockchain, crypto, wallet, token, web3, DAO, smart contract,
on-chain, gas, beautify, enhance (as a reconstruction verb), “AI
completed this room,” “live GPS courtroom proof.”

Copyright line on surfaces this phase touches: **Copyright 2026 Stead
contributors.**

Suggested badge (HM-00 must lock the final string):

> Geo-proven walkthrough · Captured by the host · Stitched, not invented

---

## 4. Journeys Claude must specify

Write `JOURNEYS-AND-COPY.md` in this folder. Minimum paths:

1. **Host, first scan** — editor → set listing coordinates → permission
   for camera + location → outdoor bookend → indoor walk → upload →
   processing → mask / whole-home → verified. Include GPS-poor and
   geofence-fail.
2. **Host, publish blocked** — draft complete, payout maybe ready, scan
   missing or failed. Book / Reserve elsewhere stays “Not open for
   bookings yet” while the platform flag is off.
3. **Guest, listing walk** — listing detail → honesty badge → enter
   indoor splat → reduced-motion / no-WebGL fallback → door tether to
   approach pano (HM-06).
4. **Guest, neighborhood** — city search → walk mode → only real
   scan-verified Stead pins → empty city is empty. No generated block.

---

## 5. Product facts the UI must not collapse

| Fact | Who sets it | Guest-visible when |
|---|---|---|
| Draft vs `active` vs `paused` | Host + server | Catalog rules unchanged |
| Scan-verified | Server / worker after geo + mask | Badge + walk CTA |
| Payout-ready (Connect) | Stripe | Host checklist only |
| Platform bookings on | Nick, `ALLOW_GUEST_BOOKINGS=1` | Book / Reserve enabled |

A verified scan does not turn bookings on. A published home without a
scan is not bookable once HM-08 ships.

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

---

## 7. Out of scope for this folder

- Editing `/design` truth files listed above.
- Visual Rails branding or “powered by” marks.
- Seed / picsum homes presented as geo-proven.
- Payment, escrow, or PAY-02 checkout redesign.
- Mapillary as the only outdoor look.

---

## 8. Claude: finish this brief when filling screens

- [ ] Lock badge + disclosure strings (point at JOURNEYS-AND-COPY).
- [ ] Specify capture permission and GPS-poor UI (no invented fix).
- [ ] Specify mask UI without an “enhance” control — even disabled.
- [ ] Specify viewer fallbacks (motion, WebGL, failed job).
- [ ] Specify empty neighborhood (no fake houses).
- [ ] Confirm Book / Reserve copy still fail-closed until Nick flips
      the flag.

When those boxes are real specs, mark the design slice Ready and stop
unless authorized to implement HM tickets.
