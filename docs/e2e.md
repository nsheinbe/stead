# Playwright e2e

Two paths the spec asked for, plus a browser smoke, plus a **gated** live Stripe suite:

| Spec | File | How |
| --- | --- | --- |
| book → check-in → checkout → deposit release | `e2e/lifecycle.spec.ts` | HTTP against the running app; mock Stripe; crons drive the escrow machine |
| cancel-with-refund | `e2e/cancel.spec.ts` | HTTP; flexible policy, more than 24h out |
| landing / explore / cancel from `/trips/:id` | `e2e/ui.spec.ts` | Chromium |
| live destination charge | `e2e/stripe.live.spec.ts` | **gated** — `npm run test:e2e:stripe` with `STRIPE_E2E=1` and your own `sk_test_` keys |

The default e2e server **unsets** Stripe keys so create-booking always takes the mock-payment path. That is why CI is stable without secrets. Do not put `sk_live_` keys, webhook secrets, or anyone else's test keys in the repo or in CI.

## Local (mock — default)

```bash
docker compose --profile test up -d db_test
export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test
npx playwright install chromium
npm run test:e2e
```

`scripts/e2e-server.ts` migrates, bootstraps `app_user` / `auth_user` with the same passwords the Vitest harness uses, and serves on `http://127.0.0.1:4173`. If `dist/` exists (after `npm run build`) it uses `npm start`; otherwise Vite.

Without `DATABASE_URL_OWNER` the Playwright config will not start a server. In CI the job provides Postgres 17 and the owner URL.

`STRIPE_E2E=1` leftover in your shell does **not** opt the live spec into this command. The default config deletes that flag so lifecycle stays on the mock path.

## Live Stripe (opt-in)

Creates a real test-mode PaymentIntent as a **destination charge**: host `acct_` is merchant of record (`on_behalf_of` + `transfer_data.destination`), platform keeps only `application_fee_amount`. Then it retrieves the intent and asserts that shape. It does not confirm a card and does not commit keys.

You need, in **your** environment (never committed):

| Variable | Value |
| --- | --- |
| `STRIPE_E2E` | `1` |
| `STRIPE_SECRET_KEY` | your `sk_test_…` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | your `pk_test_…` |
| `STRIPE_TEST_CONNECT_ACCOUNT_ID` | a test Express `acct_…` (Dashboard → Connect → Accounts, or one you onboarded on `/host/payouts`) |
| `DATABASE_URL_OWNER` | test Postgres, same as the mock suite |

```bash
docker compose --profile test up -d db_test
export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test

# Load keys from your local .env — do not paste them into chat or git.
set -a && source .env && set +a

STRIPE_E2E=1 \
  STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  VITE_STRIPE_PUBLISHABLE_KEY="$VITE_STRIPE_PUBLISHABLE_KEY" \
  STRIPE_TEST_CONNECT_ACCOUNT_ID="$STRIPE_TEST_CONNECT_ACCOUNT_ID" \
  npm run test:e2e:stripe
```

That script uses `playwright.stripe.config.ts`, which starts `e2e-server` **without** unsetting Stripe. The host fixture is stamped with `STRIPE_TEST_CONNECT_ACCOUNT_ID`. Missing that `acct_` fails closed with a clear error — create-booking would otherwise 409 (no platform-MOR fallback).

If the app is already running with those keys (`npm run dev`):

```bash
STRIPE_E2E=1 \
  STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  VITE_STRIPE_PUBLISHABLE_KEY="$VITE_STRIPE_PUBLISHABLE_KEY" \
  STRIPE_TEST_CONNECT_ACCOUNT_ID="$STRIPE_TEST_CONNECT_ACCOUNT_ID" \
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
  npm run test:e2e:stripe
```

`PLAYWRIGHT_BASE_URL` skips starting a second server. The default `npm run test:e2e` server is the wrong target for this spec — it unsets Stripe on purpose.

Connect must be enabled on the Stripe account (platform profile + Express). Until that dashboard work is done, `accounts.create` from `/host/payouts` 503s; a pre-made test `acct_` still works for this suite. See PREFLIGHT §3.

## CI

The `check` workflow runs Playwright after the production build, with Chromium. It does **not** set `STRIPE_E2E`, `STRIPE_SECRET_KEY`, or `STRIPE_TEST_CONNECT_ACCOUNT_ID`. `e2e/stripe.live.spec.ts` is included in the default project and stays skipped.

Do not add those secrets to GitHub Actions to "make CI greener." The live suite is for a laptop with your own test-mode keys.

## Auth in the suite

Tests mint an Auth.js session cookie (`authjs.session-token`) with `AUTH_SECRET`. The e2e server and Playwright share `tests/helpers/session.ts` so the salt matches the cookie name. There is no test-only login route in production.
