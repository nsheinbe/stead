# Stead — Design Handoff (Claude Design export → Claude Code)

Place this folder at `/design` in the repo root. The build prompt's §2 clause
("if design files are present, extract exact tokens") points here. This file is
the extraction, pre-done and audited.

## Files
- `Stead.dc.html` — full prototype: landing page + 10 iPhone frames covering all
  8 mobile screens. Hero headline placeholder has been resolved to the design's
  default ("Stay in homes. Skip the toll booth."); footer CTA uses "Their home.
  Your trust. Nobody's middleman."
- `ios-frame.jsx`, `image-slot.js`, `support.js` — Claude Design scaffolding.
  Reference only; do not import into the production app.

## Tokens (extracted from the export — use these, they match the spec exactly)
```css
--paper:       #FBFAF7;  /* background */
--ink:         #17201B;  /* text */
--spruce:      #1E4034;  /* primary */
--spruce-deep: #16332A;  /* primary hover/pressed */
--brass:       #B58B3E;  /* accent, verification marks */
--brass-light: #DDB672;  /* accent on dark (eyebrows over spruce) */
--brass-deep:  #8C6A2C;  /* accent text on light */
--linen:       #EFE9DF;  /* cards/surfaces */
--linen-tint:  #E8E0CE;  /* surface alt / dividers */
--claim:       #B3402A;  /* claim & dispute states ONLY */
```

## Typography (both free on Google Fonts)
- Display (headlines only): **Ibarra Real Nueva**, fallback Georgia, serif.
- UI: **Hanken Grotesk**, fallback system-ui, sans-serif.
- Money/figures: ui-monospace stack with tabular numerals (`font-variant-numeric:
  tabular-nums`).

## Audit results
- Language rules: PASS — zero occurrences of banned vocabulary (blockchain,
  crypto, wallet, web3, DAO, smart contract, on-chain, gas) in any copy.
- Landing sections: all 9 present (hero, fee math "Same stay. Different
  arithmetic.", deposit escrow, Trust Passport "One passport. Every door.",
  reviews-with-receipts, host payouts "Paid at check-in. Not in 3–5 business
  days.", member-owned "The credit union of home rentals.", FAQ, footer CTA).
- Mobile screens: all 8 present (Explore, Listing detail, Booking ×3 steps,
  Trust Passport, Trip, Deposit & Claims, Review, Host mode) across 10 frames.
- EscrowTimeline states present and correctly labeled (Held → Stay → 48-hour
  claim window → Auto-released).

## Known gaps to close in the build
1. **12 image slots are placeholders** (`<image-slot>` elements). Source warm,
   lived-in home photography (morning light, imperfect) for: hero-home,
   listing-hero, exp-1..3, ev-1..2, host-door, host-listing, pay-thumb,
   trip-thumb, 1a-hosts. Licensed/original photos before any public deploy.
2. Copy in the export uses inline styles, not classes — treat it as visual truth
   and copy source, not as production markup. Rebuild components per the build
   prompt; match spacing/hierarchy by eye against this file.
3. Fee-comparison slider and escrow timeline in the export are static mocks;
   Slices 1–2 make them live.
