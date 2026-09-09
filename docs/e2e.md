# Playwright e2e

Two paths the spec asked for, plus a browser smoke:

| Spec | File | How |
| --- | --- | --- |
| book → check-in → checkout → deposit release | `e2e/lifecycle.spec.ts` | HTTP against the running app; mock Stripe; crons drive the escrow machine |
| cancel-with-refund | `e2e/cancel.spec.ts` | HTTP; flexible policy, more than 24h out |
| landing / explore / cancel from `/trips/:id` | `e2e/ui.spec.ts` | Chromium |
| live Payment Element | `e2e/stripe.live.spec.ts` | **gated** — skipped unless `STRIPE_E2E=1` and `sk_test_` keys |

The default e2e server **unsets** Stripe keys so create-booking always takes the mock-payment path. That is why CI is stable without secrets.

## Local

```bash
docker compose --profile test up -d db_test
export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test
npx playwright install chromium
npm run test:e2e
```

`scripts/e2e-server.ts` migrates, bootstraps `app_user` / `auth_user` with the same passwords the Vitest harness uses, and serves on `http://127.0.0.1:4173`. If `dist/` exists (after `npm run build`) it uses `npm start`; otherwise Vite.

Without `DATABASE_URL_OWNER` the Playwright config will not start a server. In CI the job provides Postgres 17 and the owner URL.

## CI

The `check` workflow runs Playwright after the production build, with Chromium. It does **not** set Stripe keys. `e2e/stripe.live.spec.ts` stays skipped.

To exercise a real Payment Element locally, start the app yourself with test-mode keys and point Playwright at it:

```bash
# terminal 1
STRIPE_SECRET_KEY=sk_test_… VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… npm run dev

# terminal 2
STRIPE_E2E=1 STRIPE_SECRET_KEY=sk_test_… VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… \
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
  npm run test:e2e -- e2e/stripe.live.spec.ts
```

Do not put live (`sk_live_`) keys in CI.

## Auth in the suite

Tests mint an Auth.js session cookie (`authjs.session-token`) with `AUTH_SECRET`. The e2e server and Playwright share `tests/helpers/session.ts` so the salt matches the cookie name. There is no test-only login route in production.
