# Stead

A community-owned home rental marketplace. Hosts list because they keep more — a flat 2% network fee instead of the usual take. Deposits sit in neutral escrow. Reputation travels with you as a Trust Passport.

Apache-2.0. Copyright 2026 Stead contributors.

This is Slice 1: foundation plus guest booking. Landing, host tools, claims, reviews, and messaging land in later slices. Spec of record: `BUILD_PROMPT.md` (see the stack amendment at the top of it). Design truth: `/design` (do not edit).

## Stack

Vite + React 18 + TypeScript (strict) · Tailwind · React Router · TanStack Query · react-hook-form + zod · date-fns / date-fns-tz · **Neon Postgres + Drizzle ORM (postgres.js)** · **Hono API** · **Auth.js v5 magic link, JWT in an httpOnly cookie** · Stripe Payment Element (test mode, behind env) · Vitest

Money is integer cents. Pricing constants live in `app_config` (`network_fee_bps = 200`, and the rest of BUILD_PROMPT §3) and are snapshotted onto bookings. Availability is the `btree_gist` exclusion constraint — never check-then-insert.

## Shape of the thing

```
src/          React SPA. Talks to /api over fetch; holds no database credentials.
server/       Hono API — auth, queries, routes. The only thing that touches Postgres.
  queries/    Every read takes a session user id. This is where row scoping lives.
api/index.ts  Vercel function; vercel.json rewrites /api/* here.
drizzle/      Append-only SQL migrations. Source of truth for the schema.
scripts/      db:migrate and db:seed.
```

There is **no row-level security**. Neon has no PostgREST in front of it and no per-request database role, so the browser cannot query Postgres directly and does not try. Authorization is server-side: `requireUser` gates the routes and every function in `server/queries` takes the session user id as a required argument. `tests/authorization.test.ts` is the probe that used to be an RLS probe.

## Routes (Slice 1)

| Path | Screen |
| --- | --- |
| `/explore` | Member homes |
| `/listing/:id` | Listing detail + fee arithmetic |
| `/book/:listingId` | Book · 3 steps (dates, deposit explainer, pay) |
| `/trips` · `/trips/:bookingId` | Guest trips |
| `/login` | Magic-link email. Google OAuth is deferred. |

`/` redirects to `/explore`. The marketing landing is Slice 5.

## API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/config` | public — fee policy |
| `GET` | `/api/listings` | public — active listings |
| `GET` | `/api/listings/:id` | public if active; the host also sees their own draft/paused |
| `GET` | `/api/me` | current session, or `{ user: null }` |
| `GET` | `/api/trips` · `/api/trips/:id` | signed-in guest; `/:id` also the listing host |
| `POST` | `/api/bookings` | signed-in guest — quote, insert, Stripe client secrets |
| `POST` | `/api/stripe/webhook` | Stripe, verified by signature |
| `GET`/`POST` | `/api/cron/expire-pending` | scheduler, `Authorization: Bearer $CRON_SECRET` |
| `*` | `/api/auth/*` | Auth.js — csrf, signin, callback, session, signout |

## Local development

```bash
cp .env.example .env      # fill DATABASE_URL and AUTH_SECRET at minimum
npm install
docker compose up -d db
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/stead
npm run db:migrate
npm run db:seed
npm run dev               # SPA and API on http://localhost:5173
```

`npm run dev` serves the Hono API inside Vite's dev server, so cookies are same-origin and there is no CORS to configure.

Without `RESEND_API_KEY`, the magic link prints to the server console instead of being emailed — sign in locally by pasting it into the browser.

```bash
npm run typecheck
npm test                  # pricing + webhook unit tests always; DB tests need DATABASE_URL
npm run build
```

## Database

Neon Postgres 17. Migrations are append-only SQL under `drizzle/`, applied in filename order and recorded in `public._migrations` — never edit an applied file, add a new one.

```bash
export DATABASE_URL='postgresql://...-pooler....neon.tech/neondb?sslmode=require'
npm run db:migrate
npm run db:seed           # 1 host, 6 active listings across timezones, picsum photos
```

`server/db/schema.ts` mirrors those files for Drizzle's query builder. The SQL is authoritative because the availability lock — a `btree_gist` exclusion constraint over a generated `daterange` — is not expressible in the Drizzle pg dialect.

Use the **pooled** Neon connection string. `postgres.js` runs with `prepare: false` because Neon's pooler is PgBouncer in transaction mode. If a driver rejects `channel_binding=require`, drop it; `sslmode=require` is enough.

## Deploying to Vercel

`vercel.json` builds the SPA to `dist/`, rewrites `/api/*` to the function in `api/`, and registers the `expire-pending` cron.

Required environment variables:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | Auth.js cookie signing — `openssl rand -base64 32` |
| `CRON_SECRET` | so only the scheduler can run `expire-pending` |
| `RESEND_API_KEY` | magic-link delivery (without it the link only prints to the log) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY` | payments; the booking flow falls back to a mock path when unset |

Point the Stripe webhook endpoint at `https://<deployment>/api/stripe/webhook`.

## Self-hosting

```bash
npm run build
npm start                 # serves dist/ and the API from one origin on :3000
```

Schedule the cron yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/expire-pending
```

## Object storage

Listing photos are picsum URLs for now (real photography is a pre-launch task). Uploads — host photos and claim evidence — land in Slice 3 and target any S3-compatible bucket via the `S3_*` variables in `.env.example`: AWS S3, Cloudflare R2, Backblaze B2, or MinIO locally.

```bash
docker compose --profile storage up -d storage
# console http://127.0.0.1:9001 — minioadmin / minioadmin, create the "stead" bucket
```

```
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=stead
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=http://127.0.0.1:9000/stead
```

## Tests that need Postgres

```bash
docker compose --profile test up -d db_test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm test
```

The suite applies `drizzle/*.sql` to whatever `DATABASE_URL` points at, so a migration that only works in tests is impossible. CI starts Postgres 17 and runs typecheck, the full Vitest suite, and the build:

- pricing math table tests
- overlapping booking rejected by the gist constraint, surfaced as `DateConflictError`
- expire-pending, and Stripe event idempotency against real Postgres
- authorization probe: guest A cannot read guest B's booking; a paused listing is invisible to everyone but its host

## Copy

Banned: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.

Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout.
