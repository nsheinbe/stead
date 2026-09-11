# BASE-01 — baseline, drift log, route matrix and test inventory

Recorded 2026-09-11 on branch `redesign/ui-ux-2026-09` before any redesign code
landed. Companion to `redesign-handoff/` (the design and build handoff). The
immutable `/design` directory is untouched.

| Reference | Commit |
| --- | --- |
| Handoff baseline (`redesign-handoff/reference/BASELINE.md`) | `f63f1fc68e00d1499eefd022f51a83b1da9b3153` (merge of #20, "soft leftovers") |
| Branch point of this branch (`main` at the time) | `d2c5be5` (#21, prefer Postmark) |
| HEAD when this log was written | `d34067b5cec5eff70a7b9ce0bf5d70eeee0c445b` |

## 1. Drift: HEAD versus the handoff baseline

`git diff --stat f63f1fc HEAD -- . ':!redesign-handoff'` touches 11 files. All of it
is PR #21 (Postmark preferred over Resend for magic-link and transactional mail).
No application UI, route, DTO, migration, policy or money path changed after the
baseline. Slices 1–8 and the "soft leftovers" are intact and are preserved.

| Area | Change since `f63f1fc` | Redesign consequence |
| --- | --- | --- |
| `server/lib/emailProvider.ts` (new), `server/lib/email.ts`, `server/lib/emailFrom.ts`, `server/auth.ts` | Provider selection: Postmark (`POSTMARK_SERVER_TOKEN` / `POSTMARK_API_TOKEN`) wins over `RESEND_API_KEY`; console fallback when neither is set; `sendVerificationRequest` exported. | Keep. INT-01 changes only the browser side of sign-in and the `pages.error` mapping; it must not touch provider selection. |
| `tests/email-send.test.ts` (new), `tests/email-from.test.ts` | Provider contract tests. | Keep green. |
| `README.md`, `PREFLIGHT.md`, `docs/deploy.md`, `.env.example`, `CLAUDE.md` | Documentation for the Postmark path and `openstead.app` from-address. | Docs updated by this redesign must not reintroduce Resend-first wording. |
| `redesign-handoff/` (two commits on this branch only) | The handoff package itself. | Read-only input. Not shipped to users; not part of the Vite bundle. |

Nothing in `drizzle/`, `server/queries/`, `server/routes/`, `src/` or `e2e/` differs
from the baseline, so every source observation in the handoff (F01–F09) was
re-verified directly against HEAD rather than assumed. See §5.

## 2. Route matrix

All 18 declared routes plus the wildcard in `src/App.tsx` at HEAD, with the ticket
that owns each screen's redesign. "Shell" is the current chrome: `Shell` (desktop
header + mobile bottom nav), `Shell hideNav` (no bottom nav), or a page-owned
header (Landing only).

| ID | Route | Component | Auth at HEAD | Chrome at HEAD | Redesign owner |
| --- | --- | --- | --- | --- | --- |
| S01 | `/` | `LandingPage` | public | page-owned header/footer, no `Shell` | ACQ-01 |
| S02 | `/explore` | `ExplorePage` | public | `Shell` | RENT-01 |
| S03 | `/listing/:id` | `ListingDetailPage` | public (owner sees draft/paused) | `Shell hideNav` | RENT-01 |
| S04 | `/book/:listingId` | `BookPage` | dates public; `createBooking` needs session | `Shell hideNav` | RENT-02 (PAY-01/02, INT-03) |
| S05 | `/trips` | `TripsPage` | session (guest-only data) | `Shell` | LIFE-01 |
| S06 | `/trips/:bookingId` | `TripDetailPage` | guest or listing host | `Shell` | LIFE-01 (+ SAFE-01 claim entry) |
| S07 | `/messages` | `MessagesPage` | session | `Shell` | LIFE-02 |
| S08 | `/messages/:listingId` | `ListingMessageRedirect` | session; redirects | `Shell hideNav` | LIFE-02 / INT-02 |
| S09 | `/messages/:listingId/:guestId` | `MessageThreadPage` | participant | `Shell hideNav` | LIFE-02 |
| S10 | `/review/:bookingId` | `ReviewPage` | booking party | `Shell` | LIFE-02 |
| S11 | `/passport/:userId` | `PassportPage` | public read; owner actions | `Shell` | LIFE-02 |
| S12 | `/host/listings` | `HostListingsPage` | session | `Shell` + `HostSubnav` | HOST-02 |
| S13 | `/host/listings/:listingId` | `HostListingEditPage` | owner | `Shell` + `HostSubnav` | HOST-01/02 |
| S14 | `/host/payouts` | `HostPayoutsPage` | session | `Shell` + `HostSubnav` | HOST-03 |
| S15 | `/host/claims` | `HostClaimsPage` | session (party-scoped) | `Shell` + `HostSubnav` | SAFE-01 |
| S16 | `/host/claims/:claimId` | `HostClaimDetailPage` | host / guest / arbiter | `Shell` + `HostSubnav` | SAFE-01 |
| S17 | `/ops` | `OpsPage` | `is_ops` (server 403 otherwise) | `Shell` | SAFE-01 |
| S18 | `/login` | `LoginPage` | public | `Shell hideNav` | INT-01 |
| S19 | `*` | `<Navigate to="/explore" replace />` | public | none | NAV-01 (deliberate not-found view) |
| N01 | `/for-homeowners` | **new** | public | — | NAV-01 (route + first content), ACQ-01 (full page) |
| N02 | `/host/start` | **new** | session before save | — | NAV-01 (route), HOST-02 (wizard) |

Deep links are preserved by `vercel.json` (`/((?!api/).*)` → `index.html`), so the
two new routes need no hosting change. Old paths keep their meaning; only labels
and chrome change.

## 3. Browser ↔ API contract inventory (HEAD)

`src/lib/types.ts` is the single wire contract and is shared by the server. No DTO
extension is made in the UI-01/NAV-01 phase. Endpoints the redesign relies on:

| Endpoint | Client method | Notes for the redesign |
| --- | --- | --- |
| `GET /api/me` | `api.me` | `{ user, isOps }`. Ops nav visibility only; server 403 remains authoritative. |
| `GET /api/config` | `api.config` | `networkFeeBps`, check-in/out local times, `claimWindowHours`, `pendingPaymentTtlMinutes`. Every fee label must read this. |
| `GET /api/listings[?q,city,type,guests,maxRate,instant]` | `api.listings` | Catalog filters only. No date availability, no coordinates. |
| `GET /api/listings/:id` | `api.listing` | Full `ListingDetail`; owner may read own draft/paused (used by HOST-01 to hydrate the editor). |
| `GET /api/listings/mine` · `POST /api/listings` · `PATCH/DELETE /api/listings/:id` | host surface | `POST` requires the full required set (title, type, city, country, timezone, nightlyRateCents, depositCents, maxGuests); not a partial-draft endpoint. |
| `POST /api/listings/:id/photo-upload` · `POST /api/listings/:id/photos` · `DELETE /api/listings/photos/:photoId` | photos | Presign → PUT → attach. No reorder endpoint. |
| `POST /api/bookings` | `api.createBooking` | Returns `quote`, `paymentClientSecret`, `setupClientSecret`, `depositMethod`, `mockPayment`, `timezone`. Guest total excludes the deposit. |
| `GET /api/trips` · `GET /api/trips/:id` · `GET /api/trips/:id/cancellation` · `POST /api/trips/:id/cancel` | stays | `/api/trips` is guest-only; there is no host reservations index. |
| `GET /api/messages` · `GET /api/messages/unread` · `GET/POST /api/messages/:listingId/:guestId[/read]` · `POST /api/messages` | messaging | Unread count feeds the nav badge. |
| `GET /api/claims` · `GET /api/claims/:id` · `POST /api/claims` · `POST /api/claims/:id/respond|resolve|evidence-upload|evidence` | claims | Permissions arrive as `viewerRole`, `canRespond`, `canResolve`, `canFileEvidence`. |
| `GET /api/connect/status` · `POST /api/connect/onboard` · `GET /api/host/payouts` | payouts | Readiness is `chargesEnabled && payoutsEnabled`. |
| `GET /api/passport/:userId[/export]` · `POST /api/passport/verify` · `POST /api/identity/session` | trust | |
| `GET/POST /api/reviews/:bookingId` | reviews | |
| `GET /api/ops` | ops | Read-only snapshot. |
| `/api/auth/*` (Auth.js) · `POST /api/stripe/webhook` · `/api/cron/*` | infra | `pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" }`. |

## 4. Test inventory and actual results

Environment: this sandbox, Node 22.22.2, npm 10.9.7, dependencies from
`package-lock.json` via `npm ci`, local PostgreSQL 16.13 (Neon runs 17; no
behaviour difference observed) as the disposable owner database
`postgres://postgres:postgres@127.0.0.1:5432/stead_test`.

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | **passed** (exit 0) |
| Vitest, DB-backed | `DATABASE_URL_OWNER=… npm test` | **passed** — 29 files, 226 tests, 0 skipped |
| Vitest, no DB | `npm test` without `DATABASE_URL_OWNER` | not run here; per `tests/helpers/db.ts` the DB cases skip outside CI, so a no-DB run is not RLS evidence |
| Build | `npm run build` | run in the UI-01/NAV-01 verification, recorded in the PR |
| Playwright (mock Stripe) | `npm run test:e2e` | run in the UI-01/NAV-01 verification; the bundled Playwright 1.63 wants Chromium build 1243, which cannot be downloaded from this sandbox, so the runner is pointed at the pre-installed `/opt/pw-browsers/chromium` (build 1194) via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. CI installs its own matching build. |
| Playwright, live Stripe | `npm run test:e2e:stripe` | **skipped by configuration** — no Stripe test keys or `STRIPE_TEST_CONNECT_ACCOUNT_ID` in this environment. This is the PAY-02 release gate and stays open. |

Coverage map (what the existing suites prove, and what they cannot):

| Suite | Proves | Cannot prove |
| --- | --- | --- |
| `pricing`, `cents`, `fee-compare`, `filters`, `listings-filter` | integer cents, 30-night floor, fee truncation, filter parsing | that the browser renders the server's payable amount |
| `rls` (34), `authorization`, `host-surface` | role boundary, party visibility, no privileged writes | browser navigation state |
| `overlap`, `payment-intent`, `expire-pending` | exclusion constraint, PI uniqueness, pending expiry | connected-account SetupIntent completion |
| `escrow`, `claims`, `disputes`, `cancellation`, `cancel-booking` | state machine, refund matrix | UI confirmation flows |
| `connect`, `identity`, `storage`, `rate-limit` | Stripe parameter contracts, presign safety, limits | browser payment recovery |
| `messages`, `reviews`, `passport`, `review-reminders` | party access, publication, signing | inbox/thread UI |
| `email`, `email-from`, `email-send`, `watchdog`, `api-packaging` | provider selection, from-address refusal, function packaging | real delivery |
| `e2e/ui.spec.ts` | landing → explore link, explore lists a seeded home, signed-in cancel | email-link continuation, checkout recovery, homeowner onboarding (QA-01) |

`vitest.config.ts` includes only `tests/**/*.test.ts` in a Node environment; any
browser-oriented unit test needs a deliberate environment. `playwright.config.ts`
matches `ui.spec.ts` by name, so new spec files must be added to `testMatch`.

Copy-coupled e2e assertions that later tickets must update together with the
copy: `Member-owned home rentals` and `Find a stay` (landing, ACQ-01), `Where to`
(explore, RENT-01), `Cancel this stay` / `Confirm cancel` (trip detail, LIFE-01).

## 5. Handoff findings re-verified at HEAD

| ID | Verified at | Status |
| --- | --- | --- |
| F01 | `src/pages/HostListings.tsx:100` renders "Sign in to manage your homes" with no link; `src/components/Shell.tsx` links `/login` bare; `src/pages/Login.tsx:12` defaults `next` to `/trips` | confirmed → INT-01/02 |
| F02 | `src/pages/Book.tsx:33-41` keeps step/dates/guests in component state; `goToPayment` navigates to `/login?next=/book/${listingId}` only | confirmed → INT-03 |
| F03 | `src/pages/Login.tsx` reads `next` and `sent` only; `server/auth.ts` sets `pages.error: "/login"`, so a bad link lands on a form with no explanation; signed-in view has no continue action | confirmed → INT-01 |
| F04 | `src/pages/Book.tsx` `PayStep`: `cardTotal = guest_total_cents + deposit_cents`, "Card total today", CTA `Confirm & pay {cardTotal}`; server charges `guest_total_cents` | confirmed → PAY-01 |
| F05 | `setupClientSecret` and `depositMethod` are not referenced anywhere under `src/` | confirmed → PAY-02 |
| F06 | `src/components/PriceBreakdown.tsx:27` hardcodes "Network fee — flat 2%" | confirmed → PAY-01 |
| F07 | `src/pages/HostListingEdit.tsx` hydrates from `api.hostListings()` (summary) and PATCHes seven fields | confirmed → HOST-01 |
| F08 | `HostListings.tsx` banner text says a listing can go live before payouts; `server/routes/bookings.ts` fails closed without `acct_` | confirmed → HOST-02/03 |
| F09 | `e2e/ui.spec.ts` covers three smoke scenarios only | confirmed → QA-01 |

Additional observations not in the handoff:

- `src/lib/cents.ts` exists but the host forms compute `Math.round(Number(value) * 100)` from a `type="number"` input (`HostListings.tsx`, `HostListingEdit.tsx`). HOST-02 must route money input through the cents helper.
- `Login.tsx` accepts any `next` that starts with `/`, including `//host` (protocol-relative). INT-01's continuation helper closes this; NAV-01 already generates its own sign-in links through the same helper.
- `ListingCard.tsx` and `ListingDetail.tsx` fall back to `picsum.photos` seeds when a listing has no photo. Picsum is unreachable from this sandbox, so baseline screenshots show empty image slots. RENT-01 replaces the fallback with a "Photo unavailable" surface.
- `index.html` loads Ibarra Real Nueva and Hanken Grotesk from Google Fonts; the redesign drops the serif.

## 6. Copy that the redesign must retire (owner ticket)

Grep of `src/` for claims the product direction rules out. Each stays in place until
its owning ticket replaces the screen, so nothing is half-edited.

| Where | Text | Owner |
| --- | --- | --- |
| `Landing.tsx` | "Member-owned home rentals", "Skip the toll booth", "flat 2%", "neutral escrow", "untouchable", "instantly", "Permanent — no corporation can delete it", "Instant payout", "Keep 100% of your rate", "credit union", "Members vote", "© 2026 — member-owned" | ACQ-01 |
| `PriceBreakdown.tsx` | "Network fee — flat 2%", "Held in neutral escrow" | PAY-01 |
| `Book.tsx` | "Request to book", "Held in neutral escrow", "Card total today", "paid … instantly" | RENT-02 / PAY-01 |
| `ListingDetail.tsx` | "Request to book" / "Book this stay", "hosts list here because they keep more at 2%" | RENT-01 |
| `FeeCompare.tsx` | "Guest pays, all-in", "2% FLAT" | ACQ-01 (retain only if its inputs are verified) |
| `TrustPassportCard.tsx` | "MEMBER OWNED · NEUTRAL ESCROW", "INSTANT PAYOUT" | done (LIFE-02) |
| `Review.tsx` | "Permanent, and tied to the booking receipt" | done (LIFE-02) |
| `Trips.tsx`, `Login.tsx` | "Google sign-in is waiting on an OAuth client" (developer copy) | done (INT-01, LIFE-01) |
| `Explore.tsx` | "Run npm run db:seed against the database" | RENT-01 |
| `TripDetail.tsx` | "Guest A cannot read guest B's booking", "Slice 1 does not invent a code" | done (LIFE-01) |
| `Landing.tsx` footer | copyright line must read "Copyright 2026 Stead contributors" | NAV-01 (shared footer) |

## 6b. Phase-2 progress against that list

| Item | Status |
| --- | --- |
| F01/F03 contextual auth, error mapping, continuation | done (INT-01, INT-02) |
| F02 checkout draft loss across sign-in | done (INT-03) |
| F04/F06 deposit in card total, hardcoded "flat 2%" | done (PAY-01) |
| F05 connected-account SetupIntent unused by the browser | open — PAY-02, held |
| F07 editor hydrated from the dashboard summary | done (HOST-01) |
| F08 published vs payout-ready | done (HOST-02 states it, HOST-03 breaks readiness into its four facts) |
| Landing body copy ("member-owned", "instant payout", "permanent") | done (ACQ-01) |
| Host money inputs bypass `src/lib/cents.ts` | done (HOST-01 editor, HOST-02 wizard; the inline create form is gone) |
| Picsum photo fallback | done (ACQ-01 `ListingPhoto`, RENT-01) |
| `Explore` seed-command empty state | fixed in passing (one member-visible string) |

## 6c. Phase-3 notes

- **F07 is closed by contract, not by inspection.** `tests/listing-edit.test.ts`
  asserts over HTTP that the dashboard summary still omits `description`,
  `type`, `addressLine`, `region` and `amenities` — so if a future editor
  hydrates from it again, the round-trip test next to it fails rather than the
  defect returning silently.
- The editor now saves `diffListingInput`, so an untouched field is absent from
  the PATCH body. This is what makes a stale read safe: `PATCH /api/listings/:id`
  writes only the keys it receives.
- `lat`/`lng` remain out of `ListingInput` and `ListingDetail`. Nothing in the
  editor needs them and the handoff says not to add a map for this redesign.
- **Creation now has one path.** The inline create form on `/host/listings` is
  gone; `/host/start` is the only place a listing is created, because
  `POST /api/listings` needs a complete listing and a wizard is the honest way
  to collect one. The wizard creates the draft once, at the end of "Price and
  terms", and steps four and five continue in the editor against that real id.
- **`?done=1` is not activation.** `/host/payouts` derives readiness only from
  what the server retrieved from Stripe, and a return from onboarding starts a
  bounded poll (20 tries at 3s) that ends in an honest "Stripe hasn't confirmed
  yet" rather than a spinner. `src/lib/payoutReadiness.ts` holds that logic so
  it is testable without Stripe.
- The four Connect facts are rendered separately, because `charges_enabled` and
  `payouts_enabled` move independently: an account can take a guest's money
  while Stripe holds the payout.
- No partial-draft table was added. Before the first save the only thing kept
  on the device is the INT-03 non-sensitive set (name, type, city, country,
  time zone, capacity); rate, deposit, address and description are not.

## 6d. LIFE-01 notes

- **`pending_payment` has no resume action, deliberately.** There is no
  endpoint that hands back an existing booking's payment secret, so any
  "finish paying" link would have to send the guest through `/book/:id` and
  create a second hold on the same dates. `tests/trip-status.test.ts` asserts
  the absence, and a browser test asserts no `/book/` link appears on an
  unconfirmed stay. Resuming is PAY-02's `payment-ready` contract.
- A settling payment and an abandoned checkout are indistinguishable from the
  browser, so the copy says payment is *unrecorded* — never that it failed.
- No status is rendered from its database value any more. `src/lib/tripStatus.ts`
  maps each of the seven booking statuses to a label, a meaning and at most one
  next action, and differs by whether the viewer is the guest or the host.
- Check-in and checkout times come from `app_config`. When config has not
  loaded, the date stands alone rather than being paired with a guessed hour.

## 6e. LIFE-02 notes

- **"Publish review" was wrong about what the button did.** Submitting saves a
  review; `app.publish_due_reviews` publishes both sides together when the
  second is written or 14 days after listing-local checkout. The button now
  says "Submit your review" and the copy says what happens next.
- The 14 days is a constant inside `drizzle/0008_reviews.sql`, not config, so
  `src/lib/reviews.ts` mirrors it with a comment pointing at the migration.
- **A null rating is not a zero.** `statOrAbsent` renders "Not enough activity
  yet"; a genuine 0 still renders as 0. Both are asserted, because collapsing
  them invents a bad review out of an empty record.
- The identity card no longer swallows the profile page (S11 says it must not)
  and no longer carries claims a profile cannot make — "member owned", "neutral
  escrow", "instant payout", "issued by the members" are gone, as is the
  machine-readable strip that dressed a summary up as a document.
- Message drafts stay in component state and are never persisted. A shared
  browser would otherwise hand a half-written private message to the next
  person; the page says so rather than letting anyone assume it is saved. A
  failed send keeps every character, and the browser test forces a 503 to prove
  it.

## 6f. SAFE-01 notes

- **Arbiters could not open the claims they are meant to resolve.** `0007` gave
  them read access to `claims` and `escrow_deposits` but not to `bookings` or
  `listings`, and `getClaimForViewer` joins both — so it returned null for the
  one role with `canResolve`. `drizzle/0013_arbiter_claim_visibility.sql` adds
  two narrow SELECT policies: an arbiter reads a booking only when a claim
  exists on it, and a listing only when one of its bookings has a claim.
- The helpers behind those policies are `SECURITY DEFINER` deliberately. A
  policy on `bookings` selecting from `claims` would recurse, because the
  `claims` policy already selects from `bookings`; Postgres raises "infinite
  recursion detected in policy for relation".
- **This phase now has a migration.** `0013` is written but has NOT been
  applied to Neon — the journal there is hybrid and applying it is the
  operator's call. Until it is applied, arbitration on the deployed app stays
  broken in exactly the way it already is; nothing else regresses.
- The cross-role isolation matrix in `tests/rls.test.ts` asserted
  `arbiter → bookings = 0`. Its fixture has a claim, so `0013` changes that to
  1 by design. The assertion was updated and two probes added alongside it: an
  arbiter reading a claim-free booking is still 0, and an arbiter has no write
  path to a booking or a listing.
- **An open card dispute freezes every claim transition**, and the page now
  says so. `respond_claim`, `resolve_claim` and `file_claim` all refuse
  silently while `app.booking_has_open_dispute` is true; `ClaimDetail` carries
  `chargebackOpen` and folds it into `canRespond`/`canResolve`, so the page
  never offers an action the server will reject.
- Every irreversible action on a claim is now confirmed with its exact amount
  and who receives it before it is sent. None of them fire on a first click.

## 6g. MEAS-01 notes

- **Facts are written by triggers on the transitions, not by application code
  after them.** `stripe_events` claims an event id first, so an analytics write
  made after the confirming transaction is lost forever on a retry — the event
  is already claimed and will not be reprocessed. A trigger commits with the
  transition or not at all, and does not care which code path caused it.
- Every trigger **fails open**. A missing fact is recoverable by
  reconciliation; a refused payment is not. `tests/conversion-facts.test.ts`
  proves it by replacing the recorder with one that raises and checking the
  booking still commits.
- Lifetime dedupe is a partial unique index, not application logic, so a
  replayed webhook, a retried request and two concurrent confirmations produce
  one row. The concurrency case is asserted with three parallel calls.
- `app_user` has **SELECT only** on `conversion_facts`, scoped to its own rows,
  and no EXECUTE on the recorder. A member cannot insert, update, delete,
  forge one against someone else, or call the writer.
- Ops gets `app.conversion_totals()` — counts, never rows. A member without the
  ops flag gets nothing back at all.
- **Not done in this slice, and deliberately so:** `signup_verified` needs a
  trigger on the Auth.js identity tables, and the measurement spec says to
  validate the installed version's verification ordering first rather than
  guess. The outcome is in the enum and the table is ready for it. The delivery
  outbox and external sink are also out — a disabled sink must never discard a
  durable fact, and the facts stand on their own without one.
- **A second migration.** `0014_conversion_facts.sql` joins 0013 as written but
  not applied to Neon.

## 7. Runtime unknowns (not verifiable from source)

- Deployed configuration on Vercel + Neon: fee basis points, cron scheduling for
  `expire-pending`, webhook secrets, `PASSPORT_SIGNING_KEY`.
- Email deliverability: Postmark domain verification for `openstead.app`.
- Stripe: platform Connect readiness, the connected-account SetupIntent path (PAY-02
  investigation), Identity activation.
- Object storage: `S3_*` bucket and CORS for browser PUTs.
- Traffic, conversion and inventory: no analytics exist (MEAS-01), so no baseline
  funnel numbers are asserted anywhere in this redesign.

## 8. Baseline screenshots

`docs/redesign/screenshots/baseline/` holds viewport captures (1440×900 and 390×844,
JPEG) of `/`, `/explore`, `/listing/:id`, `/login`, `/host/listings` (signed out and
as the seed host), `/trips`, `/messages`, an unknown path, and the two new routes
(which 404-redirect to `/explore` at baseline). Captured against the seeded test
database with reduced motion; external images are blocked in this sandbox, so
photo slots are empty. "After" captures for each phase go in a sibling directory
named for the ticket.
