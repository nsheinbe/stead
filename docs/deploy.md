# Deploy pipeline — Vercel + Neon branches

Stead is a Vite SPA and a Hono API on one origin. Vercel serves `dist/` and rewrites `/api/*` to `api/index.js`, which loads the bundled Hono app from `dist-api/handler.js`. Postgres is Neon. There are no staging/prod Supabase projects.

## Environments

| Vercel | Neon branch | Who uses it |
| --- | --- | --- |
| Production | the project's default branch (usually `main`) | live traffic |
| Preview | a long-lived `preview` branch, or a per-PR branch from the Neon–Vercel integration | PR checks |

A Neon branch is a copy-on-write clone of Postgres: same roles, same schema, its own compute endpoint. Do not stand up a second Neon *project* for preview unless you want a second set of role passwords to babysit.

### Connection strings (three, always)

The Neon console hands you one URL, for a role that owns the tables and has `BYPASSRLS`. That string belongs in `DATABASE_URL_OWNER` on the **direct** host. The running app refuses to serve with it.

| Variable | Role | Host | Vercel environment |
| --- | --- | --- | --- |
| `DATABASE_URL` | `app_user` | pooled (`-pooler`) | Production + Preview |
| `AUTH_DATABASE_URL` | `auth_user` | pooled | Production + Preview |
| `DATABASE_URL_OWNER` | table owner | direct | Production (and Preview if you migrate from Vercel) |

Build the tenant URLs from the branch endpoint after `npm run db:bootstrap-roles`. Same passwords work across branches of one project; only the hostname changes.

If you enable the Neon–Vercel integration it will inject a `DATABASE_URL` for the branch owner. **Overwrite it.** Leave that value in `DATABASE_URL` and every tenant query is a silent cross-member read until `assertTenantRole` 503s. Prefer setting the three variables yourself in the Vercel project.

## First production deploy

1. Create the Neon project (`stead`). Do not create `app_user` in the console — those roles are `neon_superuser` members. The migration creates ordinary roles.
2. Put the owner **direct** URL in `DATABASE_URL_OWNER` locally and run:

   ```bash
   npm run db:migrate
   npm run db:bootstrap-roles   # prints DATABASE_URL and AUTH_DATABASE_URL once
   npm run db:seed              # optional; skip Santa Monica / other strict-enforcement cities
   ```

3. Create the Vercel project from this repo. Framework: Vite. `vercel.json` already sets the build and the `/api` rewrite.
4. Set Production env vars (table below). Redeploy.
5. Confirm:

   ```bash
   curl -sS https://<production>/api/health
   # {"ok":true}

   curl -sS https://<production>/api/auth/providers
   ```

6. Point the Stripe webhook at `https://<production>/api/stripe/webhook` (test mode until you flip keys).
7. Schedule the cron endpoints (below). Hobby Cron cannot do this.

## Preview deploys

Recommended: one long-lived Neon branch named `preview`, cloned from production.

```bash
# Neon CLI or console: create branch "preview" from the default branch
export DATABASE_URL_OWNER='postgresql://<owner>@<preview-endpoint>.<region>.aws.neon.tech/neondb?sslmode=require'
npm run db:migrate
npm run db:bootstrap-roles
```

In Vercel, set Preview (and optionally Development) to the preview-branch `app_user` / `auth_user` / owner URLs. Every PR then shares that database. Isolation is worse than a branch-per-PR; operations are simpler and the privileged-role mistake is harder to make.

Per-PR Neon branches are fine if you add a CI step that migrates the new branch and writes the three URLs into the preview deployment. The integration's single `DATABASE_URL` is still the owner — remap it.

## Environment variables

Required for the app to boot and serve members:

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | `app_user`, pooled. Never the owner. |
| `AUTH_DATABASE_URL` | yes | yes | `auth_user`, pooled |
| `AUTH_SECRET` | yes | yes | `openssl rand -base64 32`. Different per environment. |
| `CRON_SECRET` | yes | yes | Bearer secret for `/api/cron/*` |
| `AUTH_URL` / `APP_URL` | yes | recommended | Canonical origin so magic links and Identity return correctly |
| `POSTMARK_SERVER_TOKEN` | yes (Stead prod) | optional | Postmark server token. Alias: `POSTMARK_API_TOKEN`. Preferred over Resend when both are set. Verify `openstead.app` in Postmark first. |
| `RESEND_API_KEY` | no if Postmark is set | optional | Fallback only. Without either key, magic links print to the function log. |
| `AUTH_EMAIL_FROM` | **required if any send key is set** | same | `Stead <noreply@openstead.app>` or `Stead <hello@openstead.app>`. Empty or `onboarding@resend.dev` → refuse to send (Gmail). |
| `STRIPE_SECRET_KEY` | yes (live or test) | test | `sk_live_` only on Production |
| `STRIPE_WEBHOOK_SECRET` | yes | per-endpoint | Each destination has its own `whsec_` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | yes | test | Baked in at **build** time |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | no | optional | Seed host only |
| `PASSPORT_SIGNING_KEY` | yes | optional | Ed25519 PKCS8 PEM, base64. Export/verify 503 without it. |
| `OPS_ALERT_EMAIL` | yes | optional | Watchdog destination |
| `S3_*` | yes if hosting photos | MinIO or a preview bucket | See object storage in the backup runbook |
| `RATE_LIMIT_DISABLED` | no | no | `1` turns the limiter off. Leave unset in production. |

`DATABASE_URL_OWNER` is for migrations and seed, not the running function. Keep it out of the Production function env if you can run migrations from CI or a laptop; if it must live on Vercel, never copy it into `DATABASE_URL`.

Ops must verify **openstead.app** in Postmark, then set Vercel Production `POSTMARK_SERVER_TOKEN` and `AUTH_EMAIL_FROM` (`Stead <noreply@openstead.app>` or `Stead <hello@openstead.app>`). Until both are set, magic links do not send. Do not add a Resend domain for Stead.

Vite inlines `VITE_*` at build time. Changing the publishable key requires a rebuild.

## Stripe webhooks

Two destinations, two signing secrets:

| Destination | Signing secret lives in |
| --- | --- |
| `https://<production>/api/stripe/webhook` | Production `STRIPE_WEBHOOK_SECRET` |
| `https://<preview>/api/stripe/webhook` | Preview `STRIPE_WEBHOOK_SECRET` (or skip webhooks on preview and use mock payment) |

Events to send: `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, `identity.verification_session.verified`, `account.updated`.

The handler inserts the event id first and no-ops on a replay. Do **not** put a rate limit in front of this path — Stripe retries on 429 and a dropped delivery is worse than a duplicate no-op.

Locally: `stripe listen --forward-to localhost:5173/api/stripe/webhook`.

## Cron

All jobs are `GET` or `POST` `/api/cron/<name>` with `Authorization: Bearer $CRON_SECRET`. They are not in `vercel.json`: Vercel Cron on Hobby fires at most once a day and **rejects the deployment** if the expression asks for more.

| Path | Cadence |
| --- | --- |
| `/api/cron/expire-pending` | every ~10 minutes |
| `/api/cron/check-in` | hourly |
| `/api/cron/check-out` | hourly |
| `/api/cron/release-deposits` | hourly |
| `/api/cron/publish-reviews` | hourly |
| `/api/cron/review-reminders` | hourly |
| `/api/cron/watchdog` | daily |

On Pro, you can put `crons` back in `vercel.json` (see README). Otherwise use any HTTPS scheduler — a cron host, a GitHub Actions `schedule` workflow, or systemd. Each job is idempotent; a missed tick is caught by the next.

Preview does not need the scheduler unless you are exercising those paths. Production does. The watchdog emails `OPS_ALERT_EMAIL` when a heartbeat is stale or still carrying `last_error`.

## CI

`.github/workflows/ci.yml` runs typecheck, Vitest (against Postgres 17), the production build, and Playwright. Playwright uses the mock-payment path. Live Stripe is `npm run test:e2e:stripe` with `STRIPE_E2E=1` and your own `sk_test_` keys — **do not** put those in the default job. See `docs/e2e.md`.

### Connect Express (host self-serve)

The app path is `/host/payouts`. Creating the first Express account is blocked until the Stripe Dashboard platform profile exists (PREFLIGHT §3). Subscribe the webhook to `account.updated` so payout readiness lands without a page refresh.

A Production deploy should be a merge to `main` after that workflow is green. Vercel then builds from `main` with Production env.

## After a schema change

Migrations are append-only under `drizzle/`. Apply them to the Neon branch the environment points at, as the owner, on the direct host:

```bash
export DATABASE_URL_OWNER='…direct…'
npm run db:migrate
```

Preview first, then Production. `server/db/schema.ts` mirrors the SQL; the SQL is authoritative.

## Health

`GET /api/health` is liveness only — no database. `npm run verify:neon` is the sixteen-assertion check that the provisioned roles, grants, and RLS shape match what the app expects. Run it against Production after the first deploy and after any role change.
