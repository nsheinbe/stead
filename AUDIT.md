# Audit — 2026-09-01

Branch `audit/2026-09-01`, scanned from `main` @ `826eec7`. Two phases: this file was
written and pushed (read-only scan) before any fix landed; Tier 1 fixes follow as
one commit each, citing the item number below.

## Baseline (before fixes)

Environment: Node v22.14.0, npm 10.9.7, `npm ci` from the lockfile. No Docker or
Postgres binary on the machine, so the database-backed suites skipped themselves
(they gate on `DATABASE_URL_OWNER || CI`). No new tooling was installed.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | green, 3.1s |
| Unit tests | `npm test` | green — 15 passed, 23 skipped (rls, overlap, authorization, 2× expire-pending need Postgres) |
| Build | `npm run build` | green — `dist/assets/index-*.js` 284 kB (88.7 kB gzip) |
| Vulnerabilities | `npm audit` | 2 moderate, 0 high/critical — both `react-router` (see C-1) |

Skipped: the 23 Postgres-backed tests (`tests/rls.test.ts`, `tests/overlap.test.ts`,
`tests/authorization.test.ts`, the DB half of `tests/expire-pending.test.ts`). CI
runs them against Postgres 17 on every PR, so the PR check is the verification for
anything touching them. Nothing in Tier 1 touches SQL, policies, or queries.

## What was checked and found clean

* **Secrets.** No `.env` has ever been committed (`git log --all -- .env '.env.*'`
  shows only `.env.example`). No live/test Stripe, Resend, or connection-string
  values in the tree. The only `VITE_` variable is `VITE_STRIPE_PUBLISHABLE_KEY`, which
  is public by design; `src/lib/env.ts` additionally refuses anything not starting
  with `pk_`. The browser bundle imports `server/lib/pricing.ts` only (pure math);
  no server module with credentials is reachable from `src/`.
* **Privileged role as `DATABASE_URL`.** Guarded at runtime by `assertTenantRole`
  (`server/db/client.ts:107`) — checks `BYPASSRLS`, `SUPERUSER`, table ownership, and
  `row_security_active`, fails closed with a 503, and is probed in
  `tests/rls.test.ts:42`. `.env.example`, README, CLAUDE.md all say the same thing.
* **RLS.** Every tenant table in `drizzle/0001` has `ENABLE ROW LEVEL SECURITY` and
  a policy in `0002`; `stripe_events` and `cron_heartbeats` have no grant at all;
  `app_user` has no `UPDATE` on `bookings`; the four `SECURITY DEFINER` functions set
  `search_path`; `handle_new_user` was re-created as `SECURITY DEFINER` with a pinned
  `search_path` so `auth_user` can create a profile without a grant on `profiles`.
  The query layer (`server/queries/*`) mirrors the policies rather than substituting
  for them. Identity does not survive the transaction (`set_config(..., true)`).
* **Auth.js.** JWT strategy, `httpOnly` cookie, `AUTH_SECRET` required at boot,
  `trustHost: true` (correct for Vercel; see B-4 for self-host). CSRF token fetched
  and posted for sign-in and sign-out. `sessionUser()` derives the guest id from the
  cookie, never from the body, and the insert policy re-checks it.
* **Stripe.** Webhook verifies the signature before anything else; event id is
  claimed in the same transaction as the state change, so a failed confirm rolls the
  claim back and Stripe's retry gets a clean second attempt. Transactions never span
  the Stripe calls.
* **Money.** All integer cents; `quoteStay` rejects floats and negatives;
  `bookings_guest_total_match` and `bookings_nights_match` re-check in Postgres.
* **Copy.** No banned words in `src/`, `server/`, `scripts/`, or the seed.

## Findings

Sorted by severity within each tier. `file:line` refers to `main` @ `826eec7`.

### Tier 1 — fixed on this branch

| # | Severity | Where | Problem | Fix |
| --- | --- | --- | --- | --- |
| A-1 | Medium (correctness) | `server/lib/pricing.ts:36-50`, reached from `server/routes/bookings.ts:66-73` | `nightsBetween` validates shape (`\d{4}-\d{2}-\d{2}`) but not the calendar. V8 rolls `2026-02-30` over to March 2, so a request with a non-existent date passes validation, gets a quote, and then Postgres rejects `'2026-02-30'::date` (22008) inside the insert — surfaced as a generic 500 instead of a 400. The UI cannot produce this; the API can. | Round-trip the parsed date back to `YYYY-MM-DD` and reject a mismatch as `MoneyError`. Unit test added in `tests/pricing.test.ts`. |
| A-2 | Low (correctness) | `src/lib/api.ts:31-32` | `JSON.parse(text)` runs on every non-empty body. A platform-level error page (Vercel's plain-text 500, a proxy's HTML 502) throws a raw `SyntaxError`, which the pages then show to the member as "Unexpected token …" instead of the `ApiError` fallback message. | Parse defensively; a non-JSON body yields `null` and the existing `Request failed (status)` path. |
| A-3 | Low (security hygiene) | `server/routes/cron.ts:23` | `header !== \`Bearer ${secret}\`` is a short-circuiting string compare. Practically unexploitable over the network with a 64-hex secret, but the constant-time primitive is in `node:crypto` and costs nothing. | Compare with `timingSafeEqual` on equal-length buffers; unchanged 401 otherwise. |
| A-4 | Low (correctness, self-host only) | `server/node.ts:12-16` | Hono does not inherit a sub-app's `notFound` through `.route()`, so under `npm start` an unknown `/api/*` path falls through to the SPA catch-all and returns `index.html` with 200. Vercel and `npm run dev` are unaffected (they mount `server/app.ts` directly). | Register a JSON 404 for `/api/*` on the parent after mounting the app. |
| A-5 | Low (UX bug) | `src/pages/Book.tsx:37` | `guests` starts at 2 regardless of the listing. For a listing with `maxGuests: 1` the page shows "2" against "This home sleeps 1", and a member who does not touch the stepper gets a 400 (`This home sleeps 1`) on "Continue to payment". (Pressing minus did work; the commit message for this fix overstates it as unbookable.) | Derive the effective guest count as `min(wanted, listing.maxGuests)` once the listing loads. |

### Tier 2 — needs approval (listed, not changed)

| # | Severity | Where | Problem | Suggested fix |
| --- | --- | --- | --- | --- |
| B-1 | Medium (billing) | `server/routes/bookings.ts:121-142`, `:144-174` | The PaymentIntent and SetupIntent are created *before* the booking insert. If the insert then hits the exclusion constraint (23P01 → 409) or any other error, both intents are orphaned in Stripe — never cancelled, never referenced. No idempotency key on either create, so a retried request makes more of them. | On `DateConflictError` (and any insert failure) cancel the PI and SetupIntent; pass `idempotencyKey` derived from `(guest, listing, checkIn, checkOut)`. Billing path → approval. |
| B-2 | Medium (billing / state machine) | `drizzle/0002_roles_and_rls.sql:344-360`, `server/routes/stripe.ts:36-51` | `payment_intent.succeeded` arriving after the 30-minute TTL finds the booking already `expired`; `confirm_booking_for_payment_intent` returns false and the webhook returns 200. The guest has paid and holds nothing. Nothing today refunds or re-activates. | Decide the policy (refund on `expired`, or re-attempt the hold and re-confirm if dates are still free), then a new `app.*` transition + escrow_audit row per the BUILD_PROMPT §5 state machine. Schema + billing → approval. |
| B-3 | Medium (schema) | `drizzle/0001_init.sql:164,180` | `bookings.stripe_payment_intent_id` is indexed but not `UNIQUE`. `confirm_booking_for_payment_intent` updates by that id; a duplicate (bug or replay path) would confirm two rows. | New migration `0003`: `CREATE UNIQUE INDEX ... WHERE stripe_payment_intent_id IS NOT NULL`. Append-only migration → approval. |
| B-4 | Low (auth, self-host) | `server/auth.ts:95` | `trustHost: true` builds the magic-link URL from the `Host`/`X-Forwarded-Host` header. Correct on Vercel (platform-controlled), but a self-hosted deployment behind a misconfigured proxy could mint links to an attacker-supplied host. `AUTH_URL` is the documented override and `.env.example` marks it optional. | Document `AUTH_URL` as required for `npm start` deployments, or fail closed when `NODE_ENV=production` and `AUTH_URL` is unset and not on Vercel. Auth → approval. |
| B-5 | Low (correctness) | `server/routes/bookings.ts:75-79` vs `:146` | Blackout overlap is checked in one transaction and the booking inserted in a second (correctly, because Stripe sits between them). A host adding a blackout in that window gets a booking over it. Blackouts are not constraint-enforced the way overlaps are. | Re-check blackouts inside `createBookingWithEscrow`'s transaction, or add an exclusion constraint between `listing_blackouts` and `bookings`. Query/schema → approval. |
| B-6 | Low (RLS shape) | `drizzle/0002_roles_and_rls.sql:249-251` | `bookings_guest_insert` does not require the listing to be `active` or `host_id <> guest_id`; both are API checks only. Not exploitable without SQL access, but the repo's stated stance is that policies are the enforcement. | Extend the `WITH CHECK` in a new migration; add a probe to `tests/rls.test.ts`. |
| B-7 | Moderate (vuln, `npm audit`) | `package.json:39` | `react-router-dom@6.30.1` → GHSA-wrjc-x8rr-h8h6 (open redirect via backslash in `<Link>`/`useNavigate`) and GHSA-337j-9hxr-rhxg (SSR hydration; not applicable, no SSR). Fix is `react-router-dom@7.18.3`, a major. The app never navigates to user-supplied paths (`Login.tsx` only echoes `next` into `callbackUrl`, same-origin), so exposure is low. | Major bump to v7 with the `react-router-dom` → `react-router` import migration. Major → approval. |
| B-8 | Low (perf, self-host) | `server/db/client.ts:18` | `max: 1` per process is right for a serverless invocation; under `npm start` it serialises every tenant query through one backend connection. | Make pool size env-driven (`PG_POOL_MAX`, default 1). Small but affects prod behaviour → approval. |
| B-9 | Low (hygiene) | `package.json:27,38,50` | `react-hook-form`, `@hookform/resolvers`, `jsdom` have zero imports. The first two are named in BUILD_PROMPT's stack for later slices; `jsdom` implies planned component tests (`vitest.config.ts` already loads the React plugin). | Leave until the slice that uses them, or remove now if they are not coming. Intent unclear → your call. |
| B-10 | Info | `BUILD_PROMPT.md:9,224`, `PREFLIGHT.md:29-35` | Both still describe Supabase variables and `stripe listen` against localhost. CLAUDE.md says the amendment at the top of BUILD_PROMPT supersedes the body, so this is expected; noting so nobody "fixes" the body. | None. |

## After fixes

Five Tier 1 fixes, one commit each, all under the 8-fix cap. Nothing in `drizzle/`,
`server/queries/`, `server/auth.ts`, or `package.json` changed.

| Item | Commit | Files |
| --- | --- | --- |
| A-1 | `0a19acf` | `server/lib/pricing.ts`, `tests/pricing.test.ts` (+1 test) |
| A-2 | `a938043` | `src/lib/api.ts` |
| A-3 | `e384c72` | `server/routes/cron.ts` |
| A-4 | `ccac3dc` | `server/node.ts` |
| A-5 | `31a236c` | `src/pages/Book.tsx` |

### Before / after

| Check | Baseline (`826eec7`) | After (`31a236c`) |
| --- | --- | --- |
| `npm run typecheck` | green | green |
| `npm test` | 15 passed, 23 skipped | **16 passed**, 23 skipped (same Postgres-gated set) |
| `npm run build` | green, 284.12 kB / 88.73 kB gzip | green, 284.35 kB / 88.83 kB gzip |
| `npm audit` | 2 moderate | 2 moderate (B-7, major bump, not touched) |

Verification beyond the suites, run in-process with `tsx` against dummy env
(nothing written to the repo):

* A-3 — `/api/cron/expire-pending` with no header, a wrong secret, a truncated
  secret, an over-long secret, and a lowercase `bearer` all still return 401
  `Not a scheduled caller`; the right secret passes auth (and then 500s on the
  unreachable dummy DB, as expected); unset `CRON_SECRET` still 500s
  `CRON_SECRET is not set`. Identical accept/reject set to the strict compare.
* A-4 — `npm start`'s server on a scratch port: `/api/nope` and
  `/api/listings/x/y` now `404 application/json {"error":"No such endpoint"}`;
  `/api/me` still `200 {"user":null}`; `/explore` still serves `index.html`.

Not verified here: the 23 Postgres-backed tests. None of the changed files is
imported by them except `server/lib/pricing.ts` (via `tests/pricing.test.ts`, which
ran) — CI on the PR is the check.

### Needs approval (Tier 2, unchanged)

B-1 through B-10 above. Recommended order if you want them done: **B-1** (orphaned
Stripe intents on a date conflict — real test-mode clutter today, real money later),
**B-2** (paid-but-expired booking has no path), **B-3** (unique
`stripe_payment_intent_id`), then B-7 (react-router major) when a slice is
otherwise touching routing. B-4/B-8 only matter for `npm start` deployments. B-9 is
a judgment call. B-10 needs nothing.
