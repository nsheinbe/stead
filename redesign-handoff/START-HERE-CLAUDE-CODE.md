# Paste into Claude Code (Fable) — Stead full UI/UX redesign

You are implementing the complete Stead UI/UX redesign. Deliver working changes in the existing app on a **new GitHub branch**, not a standalone landing page and not edits on `main` directly.

## Repo and branch

1. Use checkout `https://github.com/nsheinbe/stead` (current `main` includes Postmark prefer path #21 and BUILD_PROMPT S1–S8).
2. Create and work on a dedicated branch from latest `main`, e.g. `redesign/ui-ux-2026-09`.
3. Do **not** overwrite the working tree with `reference/SOURCE-SNAPSHOT.zip`. That snapshot is baseline `f63f1fc` for comparison only — compare current `main` to it, preserve later work (Slices 1–8, soft leftovers, Postmark).
4. Do **not** touch the leftover bootstrap branch `claude/stead-bootstrap-w13fki`.
5. Do **not** edit the immutable `/design` directory. New tokens/assets live in app code (and optional new docs outside `/design`).
6. Open a PR against `main` when a reviewable phase is Ready. Do not merge/deploy production yourself.

## Handoff package (attach/extract this ZIP)

Extract `stead-redesign-handoff-for-fable.zip`. Reading order:

1. `START-HERE-GROK.md` + `README.md` (same completion contract; you are Fable/Claude Code)
2. `reference/BASELINE.md`
3. Repo: `CLAUDE.md`, `BUILD_PROMPT.md` (Neon/Auth.js stack amendment + Sep 2026 regulatory), `src/App.tsx`, `src/lib/types.ts`, relevant server routes
4. `brief/01-PRODUCT-DIRECTION.md`, `design/01-DESIGN-SYSTEM.md`
5. Open `prototype/index.html` for visual direction (offline). Specs beat prototype if they conflict: security/money invariants → tickets → screen specs → journeys/copy → tokens → prototype
6. `design/02-SCREEN-SPECS.md`, `design/03-JOURNEYS-AND-COPY.md` in full
7. Execute `engineering/01-BUILD-PLAN.md` with `02-ACCEPTANCE-AND-QA.md` and `03-MEASUREMENT.md`

## What to build

- Full responsive redesign of every current route (renter + homeowner acquisition, discovery, listing, auth, booking, trips, messaging, reviews, Trust Passport, host listings/edit, payouts, claims, ops).
- Add `/for-homeowners` and `/host/start`; keep old deep links working.
- New shared system: clear sans, white/cool-gray, evergreen actions, authentic imagery, restrained motion. Keep Stead name/mark.
- Fix: homeowner auth return destinations; renter checkout draft loss; ambiguous sign-in copy; expired-link recovery; consumer-facing developer copy; incorrect deposit/payment messaging.
- Resumable listing onboarding without discarding data. Only explicitly required API/DTO extensions.
- Browse before auth. One member may rent and host — intent is context, not a permanent role.
- Measurement: verified signup ≠ email submit; confirmed booking ≠ pay-button click. No PII/secrets in analytics.

## Hard constraints (never weaken)

- ≥30-night minimum (server + UI)
- Stripe Connect: host is MOR; destination charges + `application_fee_amount`; fail closed without host `acct_`. Never platform MOR / invent custody.
- Integer cents; server-authoritative quotes; Neon RLS + three DB roles; append-only migrations
- No Supabase reintroduction; no new payment processor; no short stays; no protocol token / crypto / banned copy (blockchain, wallet, web3, DAO, etc.)
- Copyright line: Copyright 2026 Stead contributors
- Prototype fixtures are illustrative — never present as real inventory, reviews, or payouts

## Execution order (from build plan)

1. BASE-01 drift log vs baseline + current main
2. UI-01 / NAV-01 shared system
3. INT-01 → INT-02/03 + PAY-01/02 (auth continuation, drafts, honest money/deposit, connected-account SetupIntent)
4. ACQ-01 → RENT-01 → RENT-02
5. HOST-01 → HOST-02 → HOST-03
6. LIFE-01/02 → SAFE-01 → MEAS-01 → QA-01 → REL-01

Ship in reviewable PRs (one coherent phase or ticket group per PR is fine). Typecheck + tests green each time. Report DB/Stripe skips explicitly. Browser evidence for desktop/mobile or mark blocked.

## Start now

Begin with BASE-01 (compare HEAD to `f63f1fc`, route matrix, test inventory), then UI-01/NAV-01 on branch `redesign/ui-ux-2026-09`. After the first Ready PR, stop for review unless told to continue phases.
