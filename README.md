# Stead

A community-owned home rental marketplace. Hosts list because they keep more — a flat 2% network fee instead of the usual take. Deposits sit in neutral escrow. Reputation travels with you as a Trust Passport.

Apache-2.0. Copyright 2026 Stead contributors.

Slices 1–8 are on this tree — the full BUILD_PROMPT plan. Guest booking, escrow, host surface, claims, reviews and the Trust Passport, the landing, messaging and cancellations, Identity and ops, then production readiness (Playwright, rate limits, Vercel + Neon deploy docs, backup/restore). Spec of record: `BUILD_PROMPT.md` (see the stack amendment at the top of it). Design truth: `/design` (do not edit). Slice status: `PROGRESS.md`.

Deploy: [`docs/deploy.md`](docs/deploy.md). Backup/restore: [`docs/backup-restore.md`](docs/backup-restore.md). Playwright: [`docs/e2e.md`](docs/e2e.md).

## Stack

Vite + React 18 + TypeScript (strict) · Tailwind · React Router · TanStack Query · react-hook-form + zod · date-fns / date-fns-tz · **Neon Postgres + Drizzle ORM (postgres.js)** · **Hono API** · **Auth.js v5 magic link, JWT in an httpOnly cookie** · Stripe Payment Element (test mode, behind env) · Vitest · Playwright

Money is integer cents. Pricing constants live in `app_config` (`network_fee_bps = 200`, and the rest of BUILD_PROMPT §3) and are snapshotted onto bookings. Stays are 30 nights or more — `nightsBetween` / `quoteStay` / create-booking reject anything shorter with a 400, and Postgres enforces the same floor. Availability is the `btree_gist` exclusion constraint — never check-then-insert.

Guest stay charges are destination charges on Stripe Connect: the host's connected account is the merchant of record (`transfer_data.destination` + `on_behalf_of`), and Stead takes only the 2% network fee as `application_fee_amount`. A host without `profiles.stripe_connect_account_id` cannot take a live payment — the route fails closed and never creates a platform-MOR PaymentIntent. Hosts attach an Express `acct_` from `/host/payouts` (Account Links; return `/host/payouts?done=1`, refresh `?refresh=1`). `account.updated` writes charges/payouts readiness. Seed a test `acct_` via `STRIPE_TEST_CONNECT_ACCOUNT_ID`; do not put secret keys in git. Creating the first Express account requires the Stripe Dashboard platform profile — that click-path is outside the repo (PREFLIGHT §3).

## Shape of the thing

```
src/          React SPA. Talks to /api over fetch; holds no database credentials.
server/       Hono API — auth, queries, routes. The only thing that touches Postgres.
  queries/    Reads and writes, all taking a transaction that carries the member id.
api/index.js  Vercel function; vercel.json rewrites /api/* here.
              Loads dist-api/handler.js, which is server/ bundled at build time.
drizzle/      Append-only SQL migrations. Source of truth for the schema and the policies.
scripts/      db:migrate, db:seed, db:bootstrap-roles, verify:neon, e2e-server.
docs/         deploy pipeline, backup/restore, Playwright.
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

State transitions are closed to `app_user` entirely. It has no `UPDATE` grant on `bookings` or `claims`, no grant that can write `reviews.published_at`, and no grant at all on `stripe_events` or `cron_heartbeats`; the enumerated `SECURITY DEFINER` functions in `app` are the complete list of state changes the API can make. That is narrower than what it replaces — the Supabase service role could write any row on any table.

## Routes

| Path | Screen |
| --- | --- |
| `/` | Landing — live fee slider (integer cents, 30-night floor). Being rebuilt under the 2026-09 redesign (see `docs/redesign/`) |
| `/for-homeowners` | Homeowner acquisition page: how listing works, guest fee from config, entry to `/host/start` |
| `/explore` | Member homes, filterable by city, type, guests, nightly rate, instant book |
| `/listing/:id` | Listing detail + fee arithmetic |
| `/book/:listingId` | Book · 3 steps (dates, deposit explainer, pay) |
| `/trips` · `/trips/:bookingId` | Guest trips; cancel with policy preview; host files a claim here during the window |
| `/messages` · `/messages/:listingId/:guestId` | Threads keyed by listing + guest; unread badges |
| `/review/:bookingId` | Double-blind review after checkout |
| `/passport/:userId` | Trust Passport; own page can start Stripe Identity |
| `/ops` | Minimal ops view — disputes, stale heartbeats, frozen payouts. Gated by `is_ops`. |
| `/host/start` | Canonical entry to listing creation; signed-out visitors get a contextual sign-in that returns here |
| `/host/listings` · `/host/payouts` · `/host/claims` | Host surface |
| `/host/claims/:id` | Claim detail, evidence, arbiter resolution |
| `/login` | Magic-link email. Google OAuth is deferred. |
| anything else | Deliberate not-found view with a way back |

The landing fee slider uses `quoteStay` for Stead's column so it cannot disagree with checkout. Nights start at 30. Compare-against-a-typical-platform math is display-only and never snaps onto a booking.

## API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/health` | public — liveness; no database |
| `GET` | `/api/config` | public — fee policy |
| `GET` | `/api/listings` | public — active listings; `q`, `city`, `type`, `guests`, `maxRate` (cents), `instant=1` |
| `GET` | `/api/listings/:id` | public if active; the host also sees their own draft/paused |
| `GET` | `/api/me` | current session, or `{ user: null }` |
| `GET` | `/api/trips` · `/api/trips/:id` | signed-in guest; `/:id` also the listing host |
| `GET`/`POST` | `/api/trips/:id/cancellation` · `/cancel` | stay parties — preview / cancel-booking. Cancel is rate-limited. |
| `GET`/`POST` | `/api/messages` · `/unread` · `/:listingId/:guestId` | participants — threads, send-message (rate-limited), mark-read |
| `POST` | `/api/bookings` | signed-in guest — quote, insert, Stripe client secrets. Rate-limited. |
| `GET`/`POST` | `/api/claims` · `/api/claims/:id` | parties + arbiter; file / respond / resolve are rate-limited |
| `POST` | `/api/claims/:id/respond` | guest — accept or dispute |
| `POST` | `/api/claims/:id/resolve` | arbiter — host / guest / split |
| `POST` | `/api/claims/:id/evidence-upload` · `/evidence` | parties — presigned image + attach |
| `POST` | `/api/stripe/webhook` | Stripe, verified by signature. Not rate-limited. |
| `GET` | `/api/passport/:userId` | public — Trust Passport + published reviews |
| `GET` | `/api/passport/:userId/export` | public — canonical trust_stats signed Ed25519 |
| `POST` | `/api/passport/verify` | public — check a signed export |
| `GET`/`POST` | `/api/reviews/:bookingId` | stay parties — form / submit (unpublished until both or 14 days) |
| `GET` | `/api/connect/status` | signed-in host — Express account + payout readiness |
| `POST` | `/api/connect/onboard` | signed-in host — create/reuse Express account, Account Link. Rate-limited. |
| `POST` | `/api/identity/session` | signed-in — Stripe Identity VerificationSession. Rate-limited. |
| `GET` | `/api/ops` | `is_ops` — disputes, heartbeats, frozen payouts |
| `GET`/`POST` | `/api/cron/expire-pending` | scheduler, `Authorization: Bearer $CRON_SECRET` |
| `GET`/`POST` | `/api/cron/publish-reviews` | both-in or 14 days after listing-local checkout |
| `GET`/`POST` | `/api/cron/review-reminders` | day 3 / day 7 after listing-local checkout |
| `GET`/`POST` | `/api/cron/watchdog` | stale/errored heartbeats → `OPS_ALERT_EMAIL` |
| `*` | `/api/auth/*` | Auth.js — csrf, signin, callback, session, signout |

Write quotas are a process-local sliding window (`server/lib/rateLimit.ts`): create-booking, cancel, send-message, file/respond/resolve-claim, Identity session, Connect onboard. The Stripe webhook is **not** limited — it is already idempotent via `stripe_events`, and a 429 would drop a retry. Set `RATE_LIMIT_DISABLED=1` only on a laptop.

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

Without a send key (`POSTMARK_SERVER_TOKEN` / `POSTMARK_API_TOKEN`, or `RESEND_API_KEY`), the magic link prints to the server console instead of being emailed — sign in locally by pasting it into the browser.

### Sending mail (Postmark, then Resend)

Stead production uses **Postmark free** with **openstead.app**. If `POSTMARK_SERVER_TOKEN` (or the `POSTMARK_API_TOKEN` alias) is set, mail goes to `https://api.postmarkapp.com/email`. Otherwise a set `RESEND_API_KEY` keeps the old Resend path. When both are set, Postmark wins.

`onboarding@resend.dev` is refused. Gmail drops it; we fail closed rather than send and bounce.

| Until you… | What breaks |
| --- | --- |
| Leave both send keys blank | Nothing — links print to the server log. Intended local-dev path. |
| Set a send key without `AUTH_EMAIL_FROM` | Magic links and transactional mail do **not** send. Logs: `AUTH_EMAIL_FROM is not set`. |
| Set `AUTH_EMAIL_FROM` to `Stead <onboarding@resend.dev>` | Same refusal. Logs name the sandbox address. |
| Verify `openstead.app` in Postmark and set `AUTH_EMAIL_FROM` | Mail sends from that address. |

Exact env var: **`AUTH_EMAIL_FROM`**. Shape: `Stead <noreply@openstead.app>` or `Stead <hello@openstead.app>`.

**Ops — Postmark + openstead.app (required before production mail lands):**

1. Verify **openstead.app** in Postmark (DNS: DKIM / Return-Path / optional DMARC) until the domain is confirmed.
2. Vercel → project → **Settings → Environment Variables** → Production (and Preview if you send from previews):
   - `POSTMARK_SERVER_TOKEN` = the Postmark server token (not a Resend key)
   - `AUTH_EMAIL_FROM` = `Stead <noreply@openstead.app>` or `Stead <hello@openstead.app>`
3. Redeploy. Until those two are set and the domain is verified in Postmark, members who request a magic link see a send error and nothing lands in Gmail.
4. Leave Resend domains alone. Resend Free is already at 3/3 elsewhere; Stead does not add one.

### Host payouts (Connect Express)

The in-app path is live: `/host/payouts` → **Continue to Stripe** → Account Link → return `?done=1` or resume `?refresh=1`. Readiness comes from a live retrieve plus `account.updated`.

**Nick — Stripe Dashboard (blocked until done).** The API cannot create the first Express account until the platform profile exists:

1. Open the Stripe Dashboard in **test mode**: [dashboard.stripe.com/test](https://dashboard.stripe.com/test)
2. Complete the **platform profile**: [dashboard.stripe.com/connect/registration](https://dashboard.stripe.com/connect/registration) — business name, support URL/email, icon. Account Links fail until this is saved.
3. **Settings → Connect** ([dashboard.stripe.com/settings/connect](https://dashboard.stripe.com/settings/connect) and [dashboard.stripe.com/account/applications/settings](https://dashboard.stripe.com/account/applications/settings)) — Express connected accounts, destination charges, onboarding branding (name / color / icon).
4. Confirm the webhook at `/api/stripe/webhook` includes `account.updated`.
5. Optional: create one test Express account and put its `acct_…` in `STRIPE_TEST_CONNECT_ACCOUNT_ID` for seed + `npm run test:e2e:stripe`.

Until those dashboard steps land, `/host/payouts` shows the Continue button and Stripe returns 503 ("Connect is not enabled on this platform yet"). Stay charges still fail closed without a host `acct_`.

```bash
npm run typecheck
npm test                  # pricing + webhook unit tests always; DB tests need DATABASE_URL_OWNER
npm run test:e2e          # Playwright mock path; needs DATABASE_URL_OWNER (docs/e2e.md)
# npm run test:e2e:stripe # opt-in; STRIPE_E2E=1 + your sk_test_ keys — never CI
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

The production recipe — Neon branches, the three role URLs, Stripe webhooks, and cron — is [`docs/deploy.md`](docs/deploy.md). Backup and restore (Neon history window, `pg_dump`, the S3 bucket) is [`docs/backup-restore.md`](docs/backup-restore.md).

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
| `POSTMARK_SERVER_TOKEN` | magic-link + transactional delivery (Postmark preferred). Alias: `POSTMARK_API_TOKEN`. Without any send key the link only prints to the log |
| `RESEND_API_KEY` | fallback if Postmark is unset |
| `AUTH_EMAIL_FROM` | required once any send key is set; e.g. `Stead <noreply@openstead.app>`. `onboarding@resend.dev` is refused |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY` | payments; the booking flow falls back to a mock path when unset |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | optional test `acct_…` stamped on the seed host; live charges fail closed without a host Connect id |
| `PASSPORT_SIGNING_KEY` | Ed25519 PKCS8 PEM, base64 — `openssl genpkey -algorithm ed25519 \| base64 -w0` |
| `OPS_ALERT_EMAIL` | watchdog destination when a cron heartbeat is stale or errored |

Point the Stripe webhook endpoint at `https://<deployment>/api/stripe/webhook`. Subscribe to `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, `identity.verification_session.verified`, `identity.verification_session.requires_input`, and `account.updated`.

Ops is a platform flag on `profiles.is_ops` — set it as the owner, the same way as `is_arbiter`. There is no designed admin screen; `/ops` is a utilitarian table.

## Scheduling the cron endpoints

Jobs are plain authenticated endpoints under `/api/cron/*`, all taking `Authorization: Bearer $CRON_SECRET`:

| Endpoint | What it does | How often |
| --- | --- | --- |
| `expire-pending` | Releases dates held by abandoned checkouts | every few minutes — roughly `pending_payment_ttl_minutes / 3` |
| `check-in` | `scheduled` → `held` at listing-local check-in | hourly is enough; it is idempotent |
| `check-out` | `held` → `claim_window` at listing-local checkout, stamping `window_closes_at` | hourly |
| `release-deposits` | `claim_window` → `released` once the window closes, and emails the guest | hourly |
| `publish-reviews` | unpublished reviews: both directions in, or 14 days after listing-local checkout | hourly |
| `review-reminders` | day 3 and day 7 follow-ups if that party has not submitted | daily is enough |
| `watchdog` | emails ops if any heartbeat is stale or errored; retries expired-and-paid refunds | daily |

Each moves only what is due and re-running one changes nothing, so a missed tick is caught by the next rather than needing a backfill. Each records a heartbeat in `cron_heartbeats` on success and on failure, so a stale `last_ok` is the signal that one has quietly stopped.

Listings span timezones, so `check-in` and `check-out` fire against each listing's own local clock — running them hourly is what makes that resolution meaningful.

Anything that can make an HTTP request will do:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/expire-pending
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/check-in
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/check-out
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/release-deposits
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/publish-reviews
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/review-reminders
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/watchdog
```

Deliberately **not** in `vercel.json`: Vercel Cron on the Hobby plan fires at most once a day, and a deployment is rejected outright if the expression asks for more, which makes it both unusable here and a confusing build failure. On Pro, add them back:

```json
"crons": [
  { "path": "/api/cron/expire-pending",   "schedule": "*/10 * * * *" },
  { "path": "/api/cron/check-in",         "schedule": "0 * * * *" },
  { "path": "/api/cron/check-out",        "schedule": "0 * * * *" },
  { "path": "/api/cron/release-deposits", "schedule": "0 * * * *" },
  { "path": "/api/cron/publish-reviews",  "schedule": "0 * * * *" },
  { "path": "/api/cron/review-reminders", "schedule": "0 15 * * *" },
  { "path": "/api/cron/watchdog",         "schedule": "0 16 * * *" }
]
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

The suite applies `drizzle/*.sql` to whatever `DATABASE_URL_OWNER` points at and then provisions the same two roles the migration defines, so a policy that only works in tests is impossible. CI starts Postgres 17 and runs typecheck, the full Vitest suite, the production build, and Playwright:

- pricing math table tests
- overlapping booking rejected by the gist constraint, surfaced as `DateConflictError`
- expire-pending, and Stripe event idempotency against real Postgres
- `tests/authorization.test.ts` — the query layer, running as `app_user`
- `tests/claims.test.ts` — legal file → accept and file → dispute → split, plus the illegal edges and the open-claim guard on release
- `tests/rls.test.ts` — adversarial probes issued as raw SQL over the `app_user` connection, bypassing every line of query code: cross-member reads, unscoped `SELECT`, impersonating another guest on insert, transitioning a booking directly, reading `stripe_events` or the identity tables, grant disjointness, identity not surviving the transaction, claim/evidence visibility including the arbiter, and a Slice 8 isolation matrix (guest A / guest B / host / arbiter / ops / anonymous)
- `tests/rate-limit.test.ts` — sliding-window math and the webhook staying off the limiter
- `e2e/` — Playwright (see `docs/e2e.md`): lifecycle + cancel-with-refund on the mock-payment path; live Stripe gated behind `STRIPE_E2E=1`

Those two files fail for different reasons on purpose. Drop a `WHERE` clause and `authorization.test.ts` goes red; drop a policy and `rls.test.ts` does. Disabling RLS on `bookings` turns five of its probes red, which is how it was checked.

## Copy

Banned: blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.

Use: neutral escrow, community-owned, member-owned, portable reputation, Trust Passport, independent arbitration, instant payout.
