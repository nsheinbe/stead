# Paste into Claude Code — Stead honesty media (Soft Dist)

You are implementing **honesty media** for Stead: a required geo-proven
property scan before a home can be bookable, plus guest indoor / outdoor
walk. Deliver work in the existing app on **GitHub branches with PRs**,
not edits on `main` directly, and not a standalone demo site.

This file is the paste-ready prompt. The engineering tickets already
exist. Your first design job is to **flesh out** the handoff under
`design/honesty-media/`. Then build the HM plan.

## Repo and branch

1. Checkout `https://github.com/nsheinbe/stead`.
2. Open **this honesty-media branch** (the branch that contains
   `docs/honesty-media/` and `design/honesty-media/`). Read the handoff
   here. Do not start from a random empty branch.
3. **Fill designs** on this branch (or a short docs/design follow-on
   off it): complete the stubs in `design/honesty-media/`.
4. **Implement HM tickets** on a dedicated implementation branch off
   latest `main` after this handoff is on `main`, unless Nick says to
   continue on this branch. One reviewable slice per PR.
5. Do **not** edit the immutable design-truth files:
   `/design/Stead.dc.html`, `/design/DESIGN_HANDOFF.md`,
   `/design/ios-frame.jsx`, `/design/image-slot.js`, `/design/support.js`.
   New honesty-media design lives only in `design/honesty-media/`.
6. Open a PR against `main` when a reviewable slice is Ready. Do not
   merge or deploy Production yourself. Do not run `db:migrate` against
   Neon without Nick.

## Load order (read before writing code)

1. This file.
2. `docs/honesty-media/README-BRANCH.md`
3. Repo: `CLAUDE.md`, `BUILD_PROMPT.md` (Neon / Auth.js stack amendment
   + Sep 2026 regulatory: 30-night floor, Connect host-MOR), `README.md`,
   `docs/soft-launch.md`
4. `docs/honesty-media/BUILD-PLAN.md` in full (HM-00 … HM-09)
5. `design/honesty-media/DESIGN_BRIEF.md`
6. `design/honesty-media/SCREEN-INVENTORY.md` — **this is yours to
   complete** (see “What to fill” below)
7. Current contracts: `src/App.tsx`, `src/lib/types.ts`,
   `server/lib/guestBookings.ts`, `server/routes/listings.ts`,
   `server/lib/storage.ts`, `drizzle/0001_init.sql` (`listings.lat` /
   `lng` already exist)

If a later screen spec conflicts with an invariant, the invariant wins:
money / RLS / kill-switch / honesty policy → BUILD-PLAN tickets →
filled screen specs → brief.

## What to fill first (`design/honesty-media/`)

Complete the design handoff before or as HM-00. Do not leave
“TBD / Claude: specify” in a Ready implementation PR.

Add or finish, as needed:

| File | Job |
|---|---|
| `DESIGN_BRIEF.md` | Already framed. Tighten copy, badge wording, and visual rules if the inventory needs them. |
| `SCREEN-INVENTORY.md` | Flesh every HM-* row: layout, states, empty/error, a11y, desktop vs phone, exact CTA labels. |
| `JOURNEYS-AND-COPY.md` | **Create.** Host scan journey + guest walk journey. Host and guest disclosures from BUILD-PLAN §4. No banned voice. |
| `TOKENS.md` or notes in the brief | Reuse Stead tokens (paper / ink / spruce / brass / linen). Brass for honesty/verification marks. Claim red (`#B3402A`) only for claim/dispute — not for “scan failed.” |

Optional later: a static HTML prototype under `design/honesty-media/prototype/`
if it helps. Illustrative only — never present as real inventory.

## What to build (after designs are specified)

Execute `docs/honesty-media/BUILD-PLAN.md`:

1. **HM-00** honesty policy + disclosure copy (lock badge wording).
2. **HM-01 → HM-02** capture client, continuous geo, listing geofence,
   presigned upload + attestation package.
3. **HM-03** COLMAP → splatfacto / gsplat worker; SuperSplat crop /
   compress only.
4. **HM-04** host rental vs private mask; publish gated on verified scan.
5. **HM-05** Spark + Three.js indoor viewer on listing detail.
6. **HM-08** require scan-verified before publish / bookable. Keep
   `ALLOW_GUEST_BOOKINGS` fail-closed.
7. **HM-06 → HM-07** outdoor approach + MapLibre pin + door tether;
   neighborhood walk + nearby Stead discovery (spatial query, no
   invented buildings).
8. **HM-09** QA, honesty badges, runbook.

MVP bar: HM-00…HM-05 + HM-08 + HM-09 (badge / scan QA).
Full Soft Dist product bar: also HM-06 and HM-07.
**Bookings on** is not a ticket — Nick sets `ALLOW_GUEST_BOOKINGS=1`
on Vercel Production after this ships and is required.

## Hard constraints (never weaken)

- Honesty reconstruction: stitch / stabilize / compress / cleanup /
  crop only. **No beautify, no generative fill, no invented rooms.**
- Geo gate: continuous Geolocation + accuracy threshold; EXIF alone
  is not proof. Indoor GPS fails closed or needs outdoor bookends —
  never invent a fix.
- `ALLOW_GUEST_BOOKINGS` is exact string `1` only
  (`server/lib/guestBookings.ts`). Unset / `0` / `"true"` / `"yes"`
  refuse create-booking. Do not flip Production. Do not “helpfully”
  default the flag on.
- ≥ 30 nights in UI, quote, and create-booking.
- Stripe Connect: host is merchant of record (`on_behalf_of` +
  `transfer_data.destination` + `application_fee_amount`). Fail closed
  without host `acct_`. Never platform-MOR.
- Integer cents; server-authoritative money; Neon RLS + three DB
  roles; append-only migrations; `DATABASE_URL` is never the owner.
- Open source, community-owned — not a protocol product. Banned voice:
  blockchain, crypto, wallet, token, web3, DAO, smart contract,
  on-chain, gas.
- Copyright line: Copyright 2026 Stead contributors.
- No seed walkthroughs on Production. No Santa Monica (or other
  strict-enforcement) invented demo inventory.
- Hard avoid: INRIA 3DGS NC, DUSt3R/MASt3R NC, Luma closed APIs,
  OpenMVS as hosted core, Mapillary as the sole outdoor layer.
- Visual Rails is optional later for heavy 3D — do not block HM-03 on
  it; do not assign Visual Rails tickets unless Nick asks.
- PAY-02 stays held unless Nick opens it.

## Evidence

Typecheck + tests green on every implementation PR. New tenant tables
get deny-by-default RLS and a raw-SQL probe in `tests/rls.test.ts`.
Keep `tests/guest-bookings.test.ts` green. Report DB / GPU / WebGL
skips explicitly. Browser-check host capture and guest walk on phone
and desktop, or mark blocked.

## Start now

1. Flesh out `design/honesty-media/SCREEN-INVENTORY.md` and write
   `design/honesty-media/JOURNEYS-AND-COPY.md` (HM-00 design).
2. Stop for review if Nick only asked for the design fill.
3. If authorized to implement, start HM-00 copy in the app, then HM-01
   on a dedicated implementation branch. After the first Ready PR, stop
   unless told to continue.

Copyright 2026 Stead contributors.
