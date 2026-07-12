# Stead — community-owned home rental marketplace

Trust-first Airbnb alternative: flat 2% fee, deposits in neutral escrow, portable reputation (Trust Passport). Spec of record: `BUILD_PROMPT.md`. Design truth: `/design/Stead.dc.html` + tokens in `/design/DESIGN_HANDOFF.md`. Never edit anything in `/design`.

## Commands (keep current as the repo evolves)

* Dev: `npm run dev`
* Typecheck: `npm run typecheck` — run after every code change
* Tests: `npm run test` (Vitest) — must pass before a slice is complete
* DB: `supabase db push` · new migration: `supabase migration new <name>`
* Functions local: `supabase functions serve`
* Stripe webhooks local: `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook`

## Invariants (never violate; ask before deviating)

* All money is integer cents. No floats, ever. Pricing math and every state transition happen ONLY in edge functions with the service role.
* Pricing constants come from `app_config`; snapshot them onto bookings.
* RLS is deny-by-default on every table. Client writes to bookings, escrow_deposits, claims, payouts, messages.read-state-only, and reviews.published_at are denied by policy.
* Escrow transitions follow the state machine in BUILD_PROMPT §5 exactly and write an `escrow_audit` row. No transition outside it.
* Webhooks are idempotent via `stripe_events` (insert event id first, skip if present).
* Bookings are protected by the btree_gist exclusion constraint — never "check-then-insert" availability in application code.
* All scheduling is listing-local time (IANA `listings.timezone`); never assume UTC for check-in/checkout.
* Migrations are append-only: never edit an applied migration; create a new one.

## Copy rules (UI, emails, seed data)

Banned words: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas. Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout. Voice: plain, confident, lightly wry. Buttons say what they do ("Release deposit", not "Submit").

## Design tokens (from /design/DESIGN_HANDOFF.md)

paper #FBFAF7 · ink #17201B · spruce #1E4034 · spruce-deep #16332A · brass #B58B3E · brass-light #DDB672 · brass-deep #8C6A2C · linen #EFE9DF · linen-tint #E8E0CE · claim #B3402A (claim/dispute states ONLY). Fonts: Ibarra Real Nueva (display headlines only), Hanken Grotesk (UI), tabular numerals on all money.

## Workflow

* One slice per session. Read BUILD_PROMPT.md for the current slice, plan first (migrations + RLS + file tree), wait for approval, then build.
* A slice is done only when its acceptance criteria pass AND typecheck + tests are green. Commit per logical change, not one giant commit.
* Make minimal changes; do not refactor unrelated code.
* When unsure between two approaches, present both and let me choose.
* Every slice adds Vitest coverage for its money math and state transitions.

## Gotchas

* Card auths last ~7 days → deposit auth-hold only when nights ≤ `deposit_auth_max_nights` (config, default 4); otherwise card-on-file path.
* Stripe Identity requires account activation even in test mode (Slice 7).
* Images in /design are placeholder slots; use picsum seeds until real photography lands (pre-launch task, not a slice).
* `pending_payment` bookings expire via cron after 30 min so the exclusion constraint doesn't dead-lock dates behind abandoned checkouts.
* Auth is magic-link email only for now — Google OAuth is deferred (TODO: enable the Google provider in Supabase Auth and add it to /login once the OAuth client is supplied).
