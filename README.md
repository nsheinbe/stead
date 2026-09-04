# Stead

A community-owned home rental marketplace. Hosts list because they keep more — a flat 2% network fee instead of the usual take. Deposits sit in neutral escrow. Reputation travels with you as a Trust Passport.

Apache-2.0. Copyright 2026 Stead contributors.

This is Slice 1: foundation plus guest booking. Landing, host tools, claims, reviews, and messaging land in later slices. Spec of record: `BUILD_PROMPT.md` (see the stack amendment at the top of it). Design truth: `/design` (do not edit).

## Stack

Vite + React 18 + TypeScript (strict) · Tailwind · React Router · TanStack Query · react-hook-form + zod · date-fns / date-fns-tz · **Neon Postgres + Drizzle ORM (postgres.js)** · **Hono API** · **Auth.js v5 magic link, JWT in an httpOnly cookie** · Stripe Payment Element (test mode, behind env) · Vitest

Money is integer cents. Pricing constants live in `app_config` (`network_fee_bps = 200`, and the rest of BUILD_PROMPT §3) and are snapshotted onto bookings. Stays are 30 nights or more — `nightsBetween` / `quoteStay` / create-booking reject anything shorter with a 400, and Postgres enforces the same floor. Availability is the `btree_gist` exclusion constraint — never check-then-insert.

Guest stay charges are destination charges on Stripe Connect: the host's connected account is the merchant of record (`transfer_data.destination` + `on_behalf_of`), and Stead takes only the 2% network fee as `application_fee_amount`. A host without `profiles.stripe_connect_account_id` cannot take a live payment — the route fails closed and never creates a platform-MOR PaymentIntent. Seed a test `acct_` via `STRIPE_TEST_CONNECT_ACCOUNT_ID`; do not put secret keys in git. Express onboarding UI is still blocked on live Connect settings.

## Shape of the thing

```
src/          React SPA. Talks to /api over fetch; holds no database credentials.
server/       Hono API — auth, queries, routes. The only thing that touches Postgres.
  queries/    Reads and writes, all taking a transaction that carries the member id.
api/index.js  Vercel function; vercel.json rewrites /api/* here.
              Loads dist-api/handler.js, which is server/ bundled at build time.
drizzle/      Append-only SQL migrations. Source of truth for the schema and the policies.
scripts/      db:migrate, db:seed, db:bootstrap-roles, verify:neon.
```

## Row-level security

Scoping is enforced by Postgres, not by the API. The browser no longer has a database role of its own — Supabase gave it one — so the request's member id travels as `app.user_id`, a transaction-local setting that every policy reads through `app.current_user_id()`. It is set with `is_local => true`, so it cannot survive into the next request that borrows the same pooled connection.

Three roles, and the separation between them is the boundary:

| Role | Carries | Host |
| --- | --- | --- |
| `app_user` | all tenant traffic, under RLS | pooled |
| `auth_user` | Auth.js only — the four identity tables and nothing else | pooled |
| the table owner | migrations and seeding, nothing else | direct |

The owner has `BYPASSRLS` and owns every table, so none of the policies apply to it. That is deliberate: it is how migrations and the `SECURITY DEFINER` transitions do their work. It also makes it the one credential that must never reach the running app.

**Neon makes that the likely mistake rather than a theoretical one.** A project hands you exactly one connection string, for a role that is a `neon_superuser` member with `BYPASSRLS`. Pasting it into `DATABASE_URL` turns the entire security model off — nothing errors, no policy is violated, queries simply return every member's rows. So the app checks: before it serves a single tenant query it confirms the connection role is ordinary, testing all three routes to bypassing RLS (the `BYPASSRLS` attribute, `SUPERUSER`, and table ownership) plus `row_security_active` as the ground truth. One memoized round trip per process; a privileged role gets a 503 and a loud log line instead of silent cross-member reads.

State transitions are closed to `app_user` entirely. It has no `UPDATE` grant on `bookings` and no grant at all on `stripe_events` or `cron_heartbeats`; the four `SECURITY DEFINER` functions in `app` are the complete list of state changes the API can make. That is narrower than what it replaces — the Supabase service role could write any row on any table.

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
| `GET` | `/api/health` | public — liveness; no database |
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
cp .env.example .env
npm install
docker compose up -d db

export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5432/stead
npm run db:migrate         # schema, roles, policies
npm run db:bootstrap-roles # prints DATABASE_URL and AUTH_DATABASE_URL — paste into .env
npm run db:seed

# also set AUTH_SECRET in .env: openssl rand -base64 32
npm run dev                # SPA and API on http://localhost:5173
```

Shell environment beats `.env`, so if you have exported `DATABASE_URL` in the terminal you are running `npm run dev` from, that value wins. Exporting the owner string for a migration and forgetting to unset it is the easy way to trip the privileged-role check.

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
export DATABASE_URL_OWNER='postgresql://<owner>:<pw>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=require'
npm run db:migrate          # direct host, owner role
npm run db:bootstrap-roles  # gives app_user and auth_user a password; prints their URLs once
npm run db:seed             # 1 host, 6 active listings across timezones, picsum photos
```

Migrations and seeding use the **direct** host; the app uses the **pooled** host (the same endpoint with `-pooler` appended). `postgres.js` runs with `prepare: false` because the pooler is PgBouncer in transaction mode. If a driver rejects `channel_binding=require`, drop it; `sslmode=require` is enough.

`server/db/schema.ts` mirrors the migration files for Drizzle's query builder. The SQL is authoritative because neither the availability lock — a `btree_gist` exclusion constraint over a generated `daterange` — nor the policies are expressible in the Drizzle pg dialect.

Do not create `app_user` in the Neon console: roles made there are `neon_superuser` members and come out with `BYPASSRLS`, which would make every policy a no-op. The migration creates them as ordinary roles, and refuses to finish if it finds one that can bypass RLS.

### Checking a provisioned database

```bash
npm run verify:neon
```

Sixteen read-only assertions against a real deployment, covering what a throwaway local cluster cannot: role shape for all three roles, migration arrival, RLS enabled-but-not-forced, grant disjointness between `app_user` and `auth_user`, identity not leaking across pooled requests, and the transition functions being present and `SECURITY DEFINER`. Pointing `DATABASE_URL` at the owner turns it red.

## Deploying to Vercel

`vercel.json` builds the SPA to `dist/` and rewrites `/api/*` to the function in `api/`. `npm run build` also emits `dist-api/handler.js` — the Hono app bundled so the serverless function does not import extensionless TypeScript paths (that is what produced `Cannot find module '/var/task/server/app'`).

After a deploy, these two should return JSON, not `FUNCTION_INVOCATION_FAILED`:

```bash
curl -sS https://<deployment>/api/health
# {"ok":true}

curl -sS https://<deployment>/api/auth/providers
# {"resend":{"id":"resend","name":"Resend","type":"email",...}}
```

Required environment variables:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | `app_user` on the **pooled** host. Not the owner — the app refuses to serve with it |
| `AUTH_SECRET` | Auth.js cookie signing — `openssl rand -base64 32` |
| `AUTH_DATABASE_URL` | `auth_user` on the pooled host |
| `DATABASE_URL_OWNER` | the owner on the **direct** host; migrations only |
| `CRON_SECRET` | so only the scheduler can run `expire-pending` |
| `RESEND_API_KEY` | magic-link delivery (without it the link only prints to the log) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY` | payments; the booking flow falls back to a mock path when unset |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | optional test `acct_…` stamped on the seed host; live charges fail closed without a host Connect id |

Point the Stripe webhook endpoint at `https://<deployment>/api/stripe/webhook`.

## Scheduling expire-pending

Abandoned checkouts hold dates behind the exclusion constraint until they expire, so `/api/cron/expire-pending` needs to run every few minutes — roughly `pending_payment_ttl_minutes / 3`. It is a plain authenticated endpoint, so anything that can make an HTTP request will do:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/expire-pending
```

Deliberately **not** in `vercel.json`: Vercel Cron on the Hobby plan fires at most once a day, and a deployment is rejected outright if the expression asks for more, which makes it both unusable here and a confusing build failure. On Pro, add it back:

```json
"crons": [{ "path": "/api/cron/expire-pending", "schedule": "*/10 * * * *" }]
```

Otherwise point any external scheduler at the URL — a cron host, a GitHub Actions `schedule` workflow, or a systemd timer.

## Self-hosting

```bash
npm run build
npm start                 # serves dist/ and the API from one origin on :3000
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
DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm test
```

The suite applies `drizzle/*.sql` to whatever `DATABASE_URL_OWNER` points at and then provisions the same two roles the migration defines, so a policy that only works in tests is impossible. CI starts Postgres 17 and runs typecheck, the full Vitest suite, and the build:

- pricing math table tests
- overlapping booking rejected by the gist constraint, surfaced as `DateConflictError`
- expire-pending, and Stripe event idempotency against real Postgres
- `tests/authorization.test.ts` — the query layer, running as `app_user`
- `tests/rls.test.ts` — adversarial probes issued as raw SQL over the `app_user` connection, bypassing every line of query code: cross-member reads, unscoped `SELECT`, impersonating another guest on insert, transitioning a booking directly, reading `stripe_events` or the identity tables, grant disjointness, and identity not surviving the transaction

Those two files fail for different reasons on purpose. Drop a `WHERE` clause and `authorization.test.ts` goes red; drop a policy and `rls.test.ts` does. Disabling RLS on `bookings` turns five of its probes red, which is how it was checked.

## Copy

Banned: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.

Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout.
