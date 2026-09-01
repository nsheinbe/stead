# Preflight — do these before opening a coding session (~30 min, one time)

An agent produces its best work when nothing has to be mocked. Every key below missing = a stubbed integration = quality drop. Do these in order.

## 1. Database — Neon (~5 min)

* Create a project at [neon.tech](https://neon.tech). Postgres 17. Any region close to your Vercel region.
* Copy the **pooled** connection string (Project → Connect → Pooled connection) into `.env` as `DATABASE_URL`. It looks like `postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require`. If a driver rejects `channel_binding=require`, drop it.
* Apply the schema and seed:

```bash
npm run db:migrate
npm run db:seed
```

* Prefer a local database while iterating: `docker compose up -d db`, then point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5432/stead` and run the same two commands. Neon branches are the CI/preview story.

## 2. Auth (~1 min)

* `openssl rand -base64 32` → `AUTH_SECRET`. This signs the session cookie; rotating it signs everyone out.
* `openssl rand -hex 32` → `CRON_SECRET`. Only the scheduler should be able to expire pending bookings.
* Google sign-in is deferred. When an OAuth client exists, add the provider in `server/auth.ts` — `public.accounts` is already there.

## 3. Stripe (~10 min)

* Create account (or use existing) — TEST MODE for everything.
* Developers → API keys: secret → `STRIPE_SECRET_KEY`, publishable → `VITE_STRIPE_PUBLISHABLE_KEY`.
* Enable Connect, platform profile, Express accounts (Settings → Connect).
* Install Stripe CLI; local webhooks: `stripe listen --forward-to localhost:5173/api/stripe/webhook` → copy the `whsec_…` value → `STRIPE_WEBHOOK_SECRET`.
* Note for Slice 7: Stripe Identity requires activating the account even for test mode — skip until that slice.

## 4. Resend (~3 min)

* Create API key → `RESEND_API_KEY`. It sends the magic link and, later, the transactional email. Dev can send from `onboarding@resend.dev`; verify a real domain before anything public. Set `OPS_ALERT_EMAIL` to yourself.
* You can skip this at first: with no key, the sign-in link prints to the server console.

## 5. Passport signing key (~1 min)

* `openssl genpkey -algorithm ed25519 | base64 -w0` → `PASSPORT_SIGNING_KEY`.

## 6. Object storage (~3 min, needed from Slice 3)

* Any S3-compatible bucket. Locally: `docker compose --profile storage up -d storage`, create a `stead` bucket at <http://127.0.0.1:9001> (minioadmin / minioadmin), and fill the `S3_*` block in `.env`.
* In production use S3, Cloudflare R2, or Backblaze B2 — same variables, `S3_FORCE_PATH_STYLE=false` for AWS.

## 7. Repo

* Copy `.env.example` → `.env`, fill it, confirm `.env` is gitignored.
* Node 20+ (`node -v`).

## 8. Kick off the session

Paste: "Read CLAUDE.md and /design/DESIGN_HANDOFF.md, then execute BUILD_PROMPT.md starting at the current slice. Output the migration SQL, the query scoping, and the file tree first and wait for my go." Discipline that keeps quality high: one slice per session; approve the plan before code; require typecheck + tests green before accepting a slice done.

## 9. Your manual verification (non-delegable)

After Slices 2, 3, and 6: walk the money paths yourself in Stripe's test dashboard — deposit auth appears at check-in, cancels on release, captures correctly on a split claim, refunds match the policy preview. Test card 4242 4242 4242 4242. Payment edge cases are where AI-written code most needs human eyes; acceptance criteria are necessary but not sufficient here.

## Remote-environment deviation (recorded 2026-07-12, updated for Neon)

This repo is built from a remote agent environment, so §3's `stripe listen` step doesn't apply — there is no localhost to forward webhooks to. Instead:

* Deploy the app (Vercel or any Node host) and create the webhook endpoint via the Stripe API pointing at `https://<deployment>/api/stripe/webhook`, subscribed to the events BUILD_PROMPT §7 handles: `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`. The route authenticates callers by verifying the Stripe signature, so it needs no session.
* Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` in the host's environment and in local `.env`.
* Secrets enter the sandbox via the environment's variable settings, never via chat, and never into git.
