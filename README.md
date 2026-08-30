# Stead

A community-owned home rental marketplace. Hosts list because they keep more — a flat 2% network fee instead of the usual take. Deposits sit in neutral escrow. Reputation travels with you as a Trust Passport.

Apache-2.0. Copyright 2026 Stead contributors.

This is Slice 1: foundation plus guest booking. Landing, host tools, claims, reviews, and messaging land in later slices. Spec of record: `BUILD_PROMPT.md`. Design truth: `/design` (do not edit).

## Stack

Vite + React 18 + TypeScript (strict) · Tailwind · React Router · TanStack Query · react-hook-form + zod · date-fns / date-fns-tz · Supabase (Auth magic link, Postgres + RLS, Edge Functions) · Stripe Payment Element (test mode, behind env) · Vitest

Money is integer cents. Pricing constants live in `app_config` (`network_fee_bps = 200`, and the rest of BUILD_PROMPT §3) and are snapshotted onto bookings. Availability is the `btree_gist` exclusion constraint — never check-then-insert.

## Routes (Slice 1)

| Path | Screen |
| --- | --- |
| `/explore` | Member homes |
| `/listing/:id` | Listing detail + fee arithmetic |
| `/book/:listingId` | Book · 3 steps (dates, deposit explainer, pay) |
| `/trips` · `/trips/:bookingId` | Guest trips |
| `/login` | Magic-link email. Google OAuth is deferred. |

`/` redirects to `/explore`. The marketing landing is Slice 5.

## Local app

```bash
cp .env.example .env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

```bash
npm run typecheck
npm test                 # pricing + webhook unit tests always; DB tests need DATABASE_URL
```

## Database

Migrations are append-only under `supabase/migrations`. Seed (`supabase/seed.sql`) creates one host and six active listings across timezones, with picsum photos and mixed cancellation policies.

Hosted project (owner's choice): **stead-dev**, region **us-east-1**, ref `aqkjkarrhancuqxxukus`.

```bash
supabase db push
supabase db reset        # local: applies migrations + seed
```

## Edge functions

- `create-booking` — validate, quote from `app_config`, insert `pending_payment` + escrow `scheduled`, return Payment Element client secrets when Stripe test keys are set.
- `stripe-webhook` — `stripe_events` insert-first idempotency; `payment_intent.succeeded` → `confirmed`.
- `expire-pending` — abandons `pending_payment` older than `pending_payment_ttl_minutes` (default 30) so the exclusion constraint does not lock dates.

Stripe, Resend, and passport keys are env vars only. Tests mock Stripe. Do not commit secrets.

## Self-host (Postgres)

```bash
docker compose up -d db
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/stead
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260830180000_slice1_foundation.sql
```

A full Auth + functions stack is `supabase start`. See `PREFLIGHT.md` and `docker-compose.yml`.

## Tests that need Postgres

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/stead_test
# or: docker compose --profile test up -d db_test
#     DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/stead_test
npm test
```

CI starts Postgres 16 and runs typecheck + the full Vitest suite, including:

- pricing math table tests
- overlapping booking rejected by the gist constraint
- expire-pending
- RLS probe: guest A cannot read guest B's booking

## Copy

Banned: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.

Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout.
