# Stead — community-owned home rental marketplace

Trust-first Airbnb alternative: flat 2% fee, deposits in neutral escrow, portable reputation (Trust Passport). Spec of record: `BUILD_PROMPT.md` — read the stack amendment at the top of it, which supersedes the Supabase references in the body. Design truth: `/design/Stead.dc.html` + tokens in `/design/DESIGN_HANDOFF.md`. Never edit anything in `/design`.

## Commands (keep current as the repo evolves)

* Dev: `npm run dev` — Vite serves the SPA and the Hono API on one origin
* Typecheck: `npm run typecheck` — run after every code change
* Tests: `npm run test` (Vitest) — must pass before a slice is complete
* DB: `npm run db:migrate` · roles: `npm run db:bootstrap-roles` · seed: `npm run db:seed` · new migration: add the next numbered file in `drizzle/`
* Check a real deployment: `npm run verify:neon`
* Local Postgres: `docker compose up -d db` · test DB: `docker compose --profile test up -d db_test`
* Self-host the built app: `npm run build && npm start`
* Stripe webhooks local: `stripe listen --forward-to localhost:5173/api/stripe/webhook`

## Invariants (never violate; ask before deviating)

* All money is integer cents. No floats, ever. Pricing math and every state transition happen ONLY on the server (`server/`), never in the browser.
* Pricing constants come from `app_config`; snapshot them onto bookings.
* RLS is deny-by-default on every tenant table and is the enforcement, not a second opinion. Scoping in `server/queries` mirrors the policies for readability; it never substitutes for them. Add a table, add its policies in the same migration.
* Three database roles. `app_user` (pooled) carries tenant traffic under RLS, `auth_user` (pooled) sees only the four identity tables, the owner (direct host) runs migrations and nothing else. Never collapse them — the owner has BYPASSRLS and the app fails closed rather than serve as it.
* The request's member id reaches policies as `app.user_id`, set with `is_local => true` inside the request transaction. Every tenant query goes through `tenantQuery`/`withMember`; never hold a transaction across an outbound HTTP call.
* Clients cannot write bookings, escrow_deposits, claims, payouts, message read-state, or reviews.published_at. `app_user` has no UPDATE grant on bookings and no grant at all on stripe_events or cron_heartbeats; state changes go through the enumerated `SECURITY DEFINER` functions in schema `app`, and a new transition means a new one of those.
* Escrow transitions follow the state machine in BUILD_PROMPT §5 exactly and write an `escrow_audit` row. No transition outside it.
* Webhooks are idempotent via `stripe_events` (insert event id first, skip if present).
* Bookings are protected by the btree_gist exclusion constraint — never "check-then-insert" availability in application code. Catch `23P01` (via `isExclusionViolation`, which walks Drizzle's `cause` chain) and return a friendly conflict.
* All scheduling is listing-local time (IANA `listings.timezone`); never assume UTC for check-in/checkout.
* Migrations are append-only: never edit an applied file in `drizzle/`; add the next numbered one. `drizzle/*.sql` is authoritative; `server/db/schema.ts` mirrors it.

## Copy rules (UI, emails, seed data)

Banned words: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas. Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout. Voice: plain, confident, lightly wry. Buttons say what they do ("Release deposit", not "Submit").

## Design tokens (from /design/DESIGN_HANDOFF.md)

paper #FBFAF7 · ink #17201B · spruce #1E4034 · spruce-deep #16332A · brass #B58B3E · brass-light #DDB672 · brass-deep #8C6A2C · linen #EFE9DF · linen-tint #E8E0CE · claim #B3402A (claim/dispute states ONLY). Fonts: Ibarra Real Nueva (display headlines only), Hanken Grotesk (UI), tabular numerals on all money.

## Workflow

* One slice per session. Read BUILD_PROMPT.md for the current slice, plan first (migration + query scoping + file tree), wait for approval, then build.
* A slice is done only when its acceptance criteria pass AND typecheck + tests are green.  Commit per logical change, not one giant commit.
* Make minimal changes; do not refactor unrelated code.
* When unsure between two approaches, present both and let me choose.
* Every slice adds Vitest coverage for its money math, state transitions, and — for any new table or policy — an adversarial probe in `tests/rls.test.ts` issued as raw SQL over the `app_user` connection.

## Gotchas

* Card auths last ~7 days → deposit auth-hold only when nights ≤ `deposit_auth_max_nights` (config, default 4); otherwise card-on-file path.
* Neon's pooled endpoint is PgBouncer in transaction mode, so `postgres.js` runs with `prepare: false`. Use the pooled string for the app and the direct one for migrations; drop `channel_binding=require` if a driver rejects it.
* Do not create `app_user` in the Neon console — roles made there are `neon_superuser` members with BYPASSRLS, which silently voids every policy. The migration creates them and refuses to finish if one can bypass RLS.
* Shell environment beats `.env` in Vite's `loadEnv`. An exported `DATABASE_URL` left over from a migration will win over the file and trip the privileged-role check.
* Drizzle wraps driver errors in `DrizzleQueryError` — the Postgres error code is on `.cause`, not the top-level error.
* Images in /design are placeholder slots; use picsum seeds until real photography lands (pre-launch task, not a slice). Uploads land in Slice 3 against the S3-compatible `S3_*` vars (MinIO locally).
* `pending_payment` bookings expire via `/api/cron/expire-pending` after 30 min so the exclusion constraint doesn't dead-lock dates behind abandoned checkouts. Call it with `Authorization: Bearer $CRON_SECRET` every few minutes. It is not in `vercel.json` on purpose: Vercel Cron on Hobby fires once a day at most and rejects the deployment if you ask for more. See README "Scheduling expire-pending".
* Auth is magic-link email only for now — Google OAuth is deferred (TODO: add the Google provider in `server/auth.ts` and a button on /login once the OAuth client is supplied; `public.accounts` already exists for it).
* Without `RESEND_API_KEY` the magic link prints to the server console. That is the intended local-dev path, not a bug.
