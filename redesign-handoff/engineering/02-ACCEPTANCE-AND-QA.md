# Stead — acceptance and QA contract

Use this checklist to prove the implementation works. It is not a report that the proposed redesign has passed tests. Baseline source: `nsheinbe/stead` at `f63f1fc68e00d1499eefd022f51a83b1da9b3153`.

## 1. Required evidence

For each build-plan ticket, record the commit, environment, executed command or manual scenario, result, linked screenshot/trace where appropriate, and unresolved issue. Classify every check as **passed**, **failed**, **not run**, or **skipped by configuration**. “Tests green” without skipped counts and environment details is insufficient.

Do not test against production data or submit real payments to obtain evidence. Use a disposable Postgres database with the real migrations and three roles, dedicated test members, approved Stripe test-mode accounts, local/captured sign-in email, and disposable object storage. Redact member emails, private addresses, messages, cookies, auth links, client secrets and evidence files from screenshots and traces before sharing them.

## 2. Existing verification surface

The repository already supplies these commands:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:e2e:stripe
```

Use `npm ci` only when the current branch has its lockfile. Preserve existing package-manager and dependency versions. `npm run build` performs type checking, builds the SPA, and builds the API. Run focused tests during work and the required full gate before release; do not repeatedly rerun unchanged suites without a reason.

| Existing suite | Relevant coverage | Important limit |
|---|---|---|
| `tests/pricing.test.ts`, `cents.test.ts`, `fee-compare.test.ts`, `filters.test.ts` | Integer cents, 30-night rejection, date counting, formatting, fee comparison and filter parsing. | These cannot prove the browser displays the server's payable amount or survives authentication. |
| `tests/rls.test.ts`, `authorization.test.ts`, `host-surface.test.ts` | Database role boundary, party/owner visibility, privileged-state writes, host data and payouts. | Database-dependent cases skip without `DATABASE_URL_OWNER` outside CI. Run raw SQL as `app_user`, not owner, for authorization assertions. |
| `tests/overlap.test.ts`, `payment-intent.test.ts`, `expire-pending.test.ts` | Exclusion conflicts, payment uniqueness, pending expiry and late-payment handling. | Real database required for relevant integration cases. |
| `tests/escrow.test.ts`, `claims.test.ts`, `disputes.test.ts`, `cancellation.test.ts`, `cancel-booking.test.ts` | Lifecycle, legal/illegal claim paths, chargebacks, refunds and cancellation rules. | Some files mix pure/router tests and DB cases; a passing file can still contain skipped integration tests. |
| `tests/connect.test.ts`, `identity.test.ts`, `storage.test.ts`, `rate-limit.test.ts` | Stripe parameter contracts, readiness/identity routing, upload helper safety and rate limits. | Mocked/router assertions do not demonstrate connected-account SetupIntent completion in the browser. |
| `tests/messages.test.ts`, `reviews.test.ts`, `passport.test.ts`, `review-reminders.test.ts` | Party access, publication, trust and reminders. | Preserve these rules while replacing their UI. |
| `tests/email.test.ts`, `email-from.test.ts`, `watchdog.test.ts`, `api-packaging.test.ts` | Email output/configuration, health checks and deployable API packaging. | Local rendering is not real email delivery or production cron health. |
| `e2e/lifecycle.spec.ts`, `cancel.spec.ts` | HTTP-level stay lifecycle and cancellation. | Not the complete browser booking journey. |
| `e2e/ui.spec.ts` | Landing/explore smoke and signed-in trip cancellation. | Current tests include old copy assertions and do not test the full auth/onboarding/checkout journeys. |
| `e2e/stripe.live.spec.ts` | Opt-in Stripe test-mode end-to-end behavior. | Must inspect and extend it to cover new setup and resume requirements; creation of a setup secret alone is insufficient. |

The Vitest configuration includes `tests/**/*.test.ts`, uses the Node environment, and disables file parallelism. Configure any new UI-oriented unit environment intentionally, or use Playwright for browser behavior. Merely adding a `.test.tsx` file will not run under the current include pattern.

The default Playwright configuration explicitly matches `ui.spec.ts` for the browser project and selected lifecycle/cancel/Stripe names for API tests. **Update `testMatch` or add new projects** when adding `auth.spec.ts`, `checkout.spec.ts`, `host-onboarding.spec.ts` and similar files; otherwise new tests may never execute. Add mobile coverage deliberately. Preserve the default mock-Stripe suite and the opt-in `playwright.stripe.config.ts` boundary.

### Disposable database gate

The repository test harness runs migrations and bootstraps roles. It changes role passwords for the test roles; only point it at a disposable test database. Its documented local database path is:

```sh
docker compose --profile test up -d db_test
DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm test
DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm run test:e2e
```

These are local fixture credentials, not production secrets. Inspect the current Compose configuration before executing. `CI` causes DB tests to be selected but does not magically supply a valid owner URL. Do not present a skipped DB suite as RLS verification. If Docker, the test database, browser binaries or Stripe test credentials are unavailable, record that exact exclusion and leave its release gate open.

## 3. Critical journey acceptance matrix

### AUTH — email links and continuation

| ID | Given / action | Expected result |
|---|---|---|
| AUTH-01 | Signed-out visitor selects “List your home,” enters a valid email and opens the sign-in link. | Server-verified session; destination is `/host/start` or the originally requested saved home. Primary action continues homeowner work. No automatic switch to trips. |
| AUTH-02 | Signed-out visitor selects dates/guests, proceeds to sign-in and opens the email in a new tab of the same browser. | Same listing/dates/guests restored at review, announced as restored, then revalidated. No duplicate booking is created by the sign-in callback. |
| AUTH-03 | The same email is opened in a different device/browser with no matching local draft. | Authentication succeeds; intended resource opens; interface explains that selections were saved in the original browser and allows re-entry. No empty or infinite spinner. |
| AUTH-04 | User returns from an invalid, expired, consumed or canceled magic link. | Clear bounded error, resend and change-email actions. No raw Auth.js codes, email enumeration, implementation jargon or lost destination. |
| AUTH-05 | Email send fails or is rate-limited; user retries or changes email. | Input retained appropriately, clear error, submit state resets, duplicate clicks controlled. “Sent” is shown only after accepted send response. |
| AUTH-06 | Already-signed-in user opens `/login` with a valid continuation. | Explicit “Continue” action or safe redirect to the intended resource; no dead-end “You are signed in.” |
| AUTH-07 | `next` contains external origins, protocol-relative paths, encoded slashes/backslashes, malformed URL, unknown route, auth-loop route or unexpected query fields. | Known safe fallback; no external navigation, data leak or auth loop. Test normalization on browser and server boundaries. |
| AUTH-08 | `/api/me` fails during a protected workflow, or session expires mid-save. | Retryable session-check error versus actual signed-out state are distinct. Reauthentication retains allowed selections; no success toast or silent loss. |
| AUTH-09 | User signs out or switches accounts on a shared browser. | Member-specific cache and private drafts are cleared/scoped. Next member cannot inspect previous member's data; UI cannot elevate ops/arbiter permissions by mode switch. |

Use a test email-link lifecycle, not only injected session cookies, for AUTH-01/02/04. Cookie fixtures remain useful for other journey tests. Ensure analytics cannot count a client-side “sent” view as verified signup.

### RENT — discovery, review and payment

| ID | Given / action | Expected result |
|---|---|---|
| RENT-01 | Visitor lands at `/`, browses `/explore`, changes supported filters, opens a home and goes back. | Both audience paths are discoverable, 30-night minimum is visible before commitment, filter URL/back state persists, keyboard focus is useful. |
| RENT-02 | No results, one result, failed listing request, missing image, paused/stale listing or slow connection. | Specific empty/error/loading states with recovery; image fallback; no fabricated homes, ratings or booking availability. |
| RENT-03 | Date selection spans 29, 30 and 31 nights; DST, leap day and listing time zone differs from browser. | Under-30 stays cannot proceed; valid calendar-date night counts agree with server; no one-night shift. |
| RENT-04 | Capacity, price/configuration, cancellation policy or availability changes after local draft was saved. | Fresh values loaded; invalid selection highlighted; changed material terms reviewed before payment. Server rejects stale/invalid booking regardless of browser. |
| RENT-05 | Example $120/night × 30 nights, fee 200 bps, $300 `card_on_file` incidentals amount. | Stay $3,600, fee $72, payable $3,672 everywhere including payment CTA. $300 shown separately; no “held in escrow” or “refunded” claim for money never charged. |
| RENT-06 | Fee configuration differs from 200 bps, or booking uses historical snapshots. | Label and amount match the relevant server quote/booking snapshot, not hardcoded 2% or current configuration. No deposit added into stay total. |
| RENT-07 | Double-click, back-forward, refresh, storage unavailable, corrupt/old/expired draft or multiple active tabs. | No crash or silent cross-tab overwrite; clear recovery and no duplicate hold/payment. Existing pending booking resumes via authorized server state, not a persisted client secret. |
| RENT-08 | Another renter takes the same dates; host blocks dates; host Connect missing. | Friendly conflict with selected context preserved. Missing Connect fails closed; no platform destination fallback. |
| RENT-09 | Deposit setup needs additional authentication, fails, succeeds but stay payment fails, or network response is lost. | Each step is honest and recoverable. Server verifies setup in the correct account; setup failure cannot produce a false “ready” state. Retry checks existing state instead of starting another payment blindly. |
| RENT-10 | Payment accepted by Stripe but server webhook is delayed, repeated or out of order. | UI shows processing until server confirms. One durable confirmation/activation event; no duplicate payout or reservation transition. |
| RENT-11 | Pending hold expires before or during payment; late payment succeeds after expiry. | Server state wins. Explain expiry/recovery accurately. Existing late-payment refund/reconciliation path is exercised and outstanding refund failures remain visible to operations. |
| RENT-12 | Production payment configuration is unavailable. | Customer-facing unavailability/recovery explanation, no technical setup instructions, no mock “success” or fake charge button. Diagnostic detail stays in operations/logs. |

For RENT-09/10/11, include a Stripe test-mode trace covering the **connected-account SetupIntent**, the platform destination PaymentIntent, their relationship to the booking, and server state after each outcome. A unit assertion that a secret starts with `seti_` does not satisfy this gate.

### HOST — draft to bookable home

| ID | Given / action | Expected result |
|---|---|---|
| HOST-01 | New homeowner starts before signing in. | Only minimal non-sensitive choices persist locally. Private details and files are not stored in anonymous browser persistence. Context survives permitted same-browser auth. |
| HOST-02 | Required listing fields are incomplete. | Clear required fields and “not yet saved to your account” state; no invalid server draft, fabricated title/price/time zone or false saved indicator. |
| HOST-03 | Valid required fields submitted; user refreshes, goes back, or retries an uncertain save. | Exactly one server listing with `status: draft`; step resumes from persisted fields; idempotent/recovery behavior prevents accidental duplicate homes. |
| HOST-04 | Existing home has description/type/region/amenities/cancellation data not shown in the dashboard summary. | Existing detail endpoint hydrates it, including owner draft/paused access; editing another field does not erase it. No uncontrolled field default writes or unnecessary new read endpoint. |
| HOST-05 | Owner selects browser time zone different from home's actual zone, invalid money string, huge number or invalid guest count. | Home time zone explicitly confirmed; integer/safe-range validation; unsupported values rejected on client and server. |
| HOST-06 | Upload fails/URL expires, file is unsupported, attach fails after upload, or user removes a photo. | Clear progress/retry, no false success; storage key belongs to this home; deleting another owner's photo fails. Existing cover/order behavior truthful; no dead reorder control. |
| HOST-07 | Another member attempts GET/PATCH/DELETE/upload/attach against this draft. | Ownership enforced by RLS and server; no private fields leaked. Raw `app_user` SQL also fails. |
| HOST-08 | Home is active but Connect account absent/incomplete/restricted. | Published state and booking readiness are visibly distinct. No “ready to earn” success or activation event until the defined durable readiness conditions hold. |
| HOST-09 | Stripe onboarding return has `done=1` but account is not ready; refresh link expired; status retrieval fails. | Re-fetch/verify actual status, explain pending/recovery state and allow safe resume. URL flag is never evidence of completion. |
| HOST-10 | Owner changes/pause/deletes a home with bookings. | Existing bookings remain intact; forbidden delete yields “pause instead”; pause does not invent a cancellation. Clear review before destructive actions. |

### LIFE — trips, messages, trust, claims and operations

| ID | Scenario | Expected result |
|---|---|---|
| LIFE-01 | Trip in every booking and escrow state, including canceled and expired. | Timeline reflects persisted audit steps and listing-local times. No future event appears completed. Correct next action for the viewer. |
| LIFE-02 | Guest/host previews and confirms cancellation at every existing policy boundary. | Server-returned refund and retained fee shown before confirmation; controls reflect allowed status; no client-written refund/escrow state. |
| LIFE-03 | Message inquiry before booking, sending retry, unread count, another party's thread. | Correct participant access, truthful send status, no duplicate message on naïve retry, server-controlled read state and no stranger access. |
| LIFE-04 | Review unavailable, eligible, submitted/unpublished, or published. | Rules remain intact; publication cannot be forced by browser or counterpart. Required rating/error UX works by keyboard. |
| LIFE-05 | Passport for self/another member, unavailable identity service, export error. | Actual verification/reputation status, honest absence of evidence; no client “verified” flag or unsupported trust guarantee. |
| LIFE-06 | Open claim, acceptance, dispute, arbitration and each resolution; invalid amount/late window. | Exact legal transition only, both parties' permitted evidence visible, amount ≤ deposit, required confirmation/error recovery. Host cannot act as guest/arbiter. |
| LIFE-07 | Open chargeback with frozen payout/deposit restrictions. | Existing restrictions visible; no release/claim action that bypasses the server state machine. |
| LIFE-08 | Regular member opens ops; ops user opens a page they do not otherwise own. | Existing `is_ops` gate and limited visibility maintained; ops does not become arbiter or unrestricted member automatically. |

## 4. Accessibility and responsive gate

Test the actual running app, not only the static prototype. Use automated accessibility checks as a supplement to manual keyboard and screen-reader review. If adding an accessibility testing package, add it as a pinned-compatible development dependency and document it. An automated score alone is not compliance evidence.

- Browser/viewport matrix: Chromium desktop at 1440×900 and 1024×768; Chromium mobile at 390×844 and 360×800; 320 px width stress check; tablet 768×1024; Safari/WebKit for email return, sticky controls, date inputs and Stripe navigation; Firefox smoke for public and form routes where supported by the test environment. Record unsupported browsers rather than claiming universal support.
- Keyboard: skip link works, navigation order follows reading order, no positive tab index, every menu/dialog/drawer traps focus only when modal and restores it on close, Escape works where expected, sticky UI never covers focused controls.
- Forms: visible persistent labels, correct autocomplete and input modes, field-specific error association, error summary/focus after submit, busy states announced once, no validation solely by color, no resetting entered data after recoverable errors.
- Dates: individual full-date accessible labels, selected/range/unavailable states conveyed programmatically, month-change announcement, keyboard navigation and an accessible fallback for entering a valid range. A grid of unlabeled day numbers is insufficient.
- Contrast: meet the applicable WCAG 2.2 AA text/non-text contrast criteria. Measure each semantic token against its actual background, including muted text, disabled states, validation and focus rings; decorative brand tones need not be reused for body text.
- Touch targets: meet WCAG 2.2 minimum sizing/spacing requirements; aim for at least 44×44 CSS px on primary mobile controls. Ensure stepper, close, carousel and upload/remove actions remain usable.
- Zoom/reflow: 200% zoom, 400% narrow-width reflow and enlarged system text without lost actions or two-dimensional reading for ordinary content. Money rows wrap without truncating the payable total.
- Screen reader: VoiceOver + Safari minimum manual check for homepage, sign-in, date review, booking/payment handoff, homeowner form, claim dialog. Announce status updates without reading the whole page again.
- Motion: honor `prefers-reduced-motion`; no autoplay hero, scroll-jacking or essential content revealed only by animation. Keep focus and loading state coherent when transitions are disabled.
- Images: meaningful alt text for informational home photos; decorative imagery empty alt; dimensions/aspect ratios avoid layout shift; gallery controls accessible without drag gestures.

## 5. Performance and reliability gate

These are proposed engineering targets, not measured baseline results or promised conversion uplift:

| Area | Target / test |
|---|---|
| Public-page loading | Measure on a documented mobile profile with cold cache. Target field p75 LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1 when sufficient real traffic exists. Use lab measurements as pre-release proxies and label them as lab data. |
| Payload | Record before/after JS/CSS/image transfer size by key route. Investigate material regressions; do not preload Stripe, host tools or ops code on the landing page unnecessarily. |
| Photography/fonts | Responsive image sources, defined dimensions, lazy-load below-the-fold images, prioritize only likely LCP image, bounded font weights and fallbacks. Use real assets sized for their slot. |
| Network states | Slow and offline transitions, timed-out saves, API 401/403/404/409/429/500/502/503 and non-JSON proxy errors handled without losing permitted data or exposing raw internals. |
| Long content | Long city/title/name, no photo, large currency total, many messages, multiple claims, many listing cards; no clipped primary action or unreadable table. |
| Navigation | Direct URL refresh works under actual hosting configuration; known old links survive; unknown paths have a helpful destination; no client/server route collision. |

## 6. Measurement acceptance

- Event validation rejects unknown fields, raw URLs, secrets and freeform strings outside bounded enums.
- First-time verified signup, returning sign-in and email sent generate different events. A refresh/replayed callback cannot produce another signup.
- Renter/homeowner context is attribution, not a permission mutation. Unknown/cross-device attribution remains unknown; dual-role members are not double-counted in the total account count.
- Booking activation is emitted from the durable confirmed transition; host activation follows the defined server-observed readiness condition regardless of which prerequisite happened first.
- Duplicate/concurrent/out-of-order webhooks and transaction failure do not lose or duplicate conversion facts. Durable fact/outbox writes are atomic with the transition where appropriate; external analytics failures cannot fail a booking or sign-in.
- Reconciliation can recover missing delivery without inventing event times or marketing source. Verified facts remain queryable even when the external analytics sink is disabled.
- Consent decline, storage unavailable and blocked client tracking leave booking/sign-in functional and do not manufacture a complete funnel. Report identifiable coverage gaps.

## 7. Final release checklist

1. Typecheck and both build outputs pass; all existing domain tests retained or deliberately updated with a documented behavioral reason.
2. Full disposable DB suite passes with three-role/RLS assertions. No skipped security/financial integration gate is hidden in the summary.
3. New Playwright files are discovered and run. Primary signed-out renter, homeowner and expired-email flows pass on desktop/mobile; supported WebKit paths checked.
4. Stripe test-mode setup + destination charge + delayed confirmation + failure/retry/expiry evidence is complete; mock-only results are labeled.
5. Every route has required loading/empty/error/unauthorized states and before/after screenshots at representative widths.
6. Copy and photography provenance reviewed. No fake inventory/reviews, unsupported savings/earnings, instant payout or escrow custody claims reach production.
7. Migration compatibility, event dedupe/reconciliation, operational health and rollback rehearsal recorded. Open issues explicitly categorized as release blockers or bounded deferred work.
8. Final review links exact commit/artifact and evidence. Operator authorizes production release separately; local redesign work needs no repeated permission gate.
