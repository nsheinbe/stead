# Stead — engineering build plan

**Deliverable:** a complete implementation brief for Grok or another coding agent. This document proposes work; it does not claim that work has shipped. The accompanying prototype illustrates the intended interface and contains demonstration data, not a connected marketplace.

**Code baseline:** `nsheinbe/stead`, commit `f63f1fc68e00d1499eefd022f51a83b1da9b3153`, reviewed from a read-only checkout. Reconcile the current branch against this commit before implementation. References below are repository-relative so this package remains portable. Test commands are instructions to the builder, not claims of tests executed for this document.

## 1. Outcome and scope

Redesign every existing public, renter, homeowner and operations route with one coherent system. Make the two acquisition journeys clear: find a home for 30 nights or more; list a home and become ready to accept a booking. Optimize for verified first-time accounts **and** useful activation, rather than collecting email addresses without completing the next task.

Use first-principles reasoning to remove a screen, question or decoration when it does not support a real decision. Use restrained typography, spacing, hierarchy and honest materials as aesthetic principles; do not imitate Apple screens, marks or product imagery. The design documents and prototype in this package define the new visual direction.

Included: discovery, listing detail, sign-in, booking, trips, cancellations, messages, reputation, reviews, homeowner acquisition, listing creation/editing, payouts, claims, operations, responsive behavior, accessibility, error recovery, instrumentation, test coverage and release procedure. New route proposals are `/for-homeowners` and `/host/start`. Preserve all existing deep links. Do not invent a separate homeowner authentication system or force each member into one permanent persona.

Excluded unless a later ticket explicitly adds them: new payment processors, short stays, instant payout promises, new arbitration providers, earnings forecasts, unsupported insurance claims, OAuth without supplied configuration, recommendation engines, map/geocoding vendors, migration to a different framework, and a new analytics vendor purchase. No production deployment, real payment or email campaign is implied by this handoff.

## 2. Instructions for the building agent

1. Read this package, the current repository `CLAUDE.md`, the stack amendment in `BUILD_PROMPT.md`, `README.md`, and any applicable `AGENTS.md`. Keep the repository's security, money, state-machine and append-only migration rules.
2. The user's authorization is a **full UI/UX redesign**. Old visual-truth/minimal-change instructions do not prohibit the authorized redesign. Leave the original `/design` reference directory untouched; implement the new system in application code and store any new references outside that directory.
3. The old “wait for approval, then build one slice” workflow is not an additional approval gate for already authorized, reversible local implementation. Build the dependency-ordered slices below, commit logically and produce reviewable results. Production launch remains an explicit operator decision.
4. Keep React 18, Vite, React Router, TanStack Query, React Hook Form/Zod where useful, Tailwind/CSS, Hono, Drizzle, Neon Postgres, Auth.js email links, S3-compatible uploads, and Stripe Connect. Inspect installed versions instead of upgrading them as part of a visual refresh.
5. Record differences between the baseline and current code. Turn newly discovered functional regressions into scoped tickets; do not erase working behavior merely because the prototype simplifies it.
6. Use licensed, approved real home photography for production. The prototype's illustrative homes and numbers must not become real inventory, testimonials or market statistics.

## 3. Established code findings versus proposals

These are source observations at the baseline; they are not measurements of live abandonment or proof that a deployed service is broken.

| ID | Observed at baseline | Consequence to test | Proposed work |
|---|---|---|---|
| F01 | `HostListings.tsx` renders a signed-out banner without a contextual sign-in action. `Shell.tsx` links to `/login`; `Login.tsx` defaults `next` to `/trips`. | A homeowner can lose their intended destination through the generic sign-in path. | INT-01/02: contextual auth and homeowner continuation. |
| F02 | `Book.tsx` holds check-in, checkout, guest count and step in component state; its signed-out navigation keeps only `/book/:listingId`. | Email sign-in remounts checkout without the selected stay. | INT-03: versioned, expiring local selection draft and recovery UI. |
| F03 | Auth.js routes errors to `/login`, but `Login.tsx` does not read its `error` query parameter. The signed-in view has no primary continuation to `next`. | Invalid/expired links and already-signed-in returns lack a clear recovery/continue action. | INT-01: safe error mapping and continuation. |
| F04 | `Book.tsx` adds `deposit_cents` to the payment button and “Card total today.” The server's destination charge uses `guest_total_cents`; the deposit is excluded by pricing tests. | UI charge explanation conflicts with the existing server amount. | PAY-01: use authoritative quote, display deposit method separately. |
| F05 | `POST /api/bookings` returns `setupClientSecret` and `depositMethod`; `Book.tsx` never uses the setup secret. The setup intent is created on the host's connected account. | Deposit card setup is not completed by the visible browser implementation. End-to-end processor behavior needs investigation. | PAY-02: verified connected-account setup and payment recovery before live rollout. |
| F06 | `PriceBreakdown.tsx` hardcodes the label “flat 2%”; the server reads fee configuration and snapshots money on bookings. | Config changes or historical bookings can have a misleading label. | PAY-01: derive the displayed rate from the correct server contract; do not reverse-engineer it from rounded cents. |
| F07 | The `/api/listings/mine` `HostListing` summary omits fields needed by the full editor; existing `api.listing(id)` / `ListingDetail` returns them and permits the owner to view their draft/paused home. The existing editor uses the summary. | A wizard must not overwrite existing omitted data with empty defaults. | HOST-01: hydrate the editor from existing detail reads, verify ownership and preserve untouched fields. |
| F08 | Listings can currently become `active` before payout readiness. UI explicitly says so. Live booking fails closed if no Connect account exists. | “Published,” “payout-ready,” and “ready to accept bookings” are different facts. | HOST-02/03: explicit checklist and derived readiness; no silent status-model change. |
| F09 | Existing browser tests cover public pages and cancellation, not complete email-link continuation, checkout recovery or homeowner onboarding. | The critical redesigned journeys need additional browser coverage. | QA-01 and journey-specific tests. |

Other observations needing an operator/runtime check: current traffic and conversion rates, real inventory availability, image rights, testimonial provenance, email deliverability, Stripe platform readiness, production cron execution and deployed configuration. Never represent these as established failures or fabricate improvements.

## 4. Non-negotiable implementation boundaries

### Money and reservations

- All money remains integer cents. Existing `server/lib/pricing.ts` is authoritative; never accept a browser total as the charge amount. Shared browser helpers may format or preview an estimate, but confirmation uses the server response. Parse editable USD input as a string with `src/lib/cents.ts` and add safe-integer/range checks; do not multiply floating-point input by 100.
- Keep the 30-night minimum in UI, server and database. Use listing-local calendar dates and IANA time zones. A “30-night example” is not a fixed calendar-month price.
- Read configurable fee, claim-window and expiry values from the appropriate API. Existing booking snapshots remain historical truth even if configuration changes later.
- Keep the database exclusion constraint for overlapping reservations, blackout checks, capacity checks, own-home booking prohibition and friendly `409` conflicts. Do not replace them with browser availability checks.
- Keep `pending_payment` expiry and the existing late-payment/refund handling. The 30-minute default starts when the server creates a pending booking, **not** when someone starts signing in or selects dates.
- Live stay charges keep `on_behalf_of`, `transfer_data.destination` and `application_fee_amount`. Missing host Connect configuration fails closed. The deposit setup/charge remains in the host connected-account context. Do not move it to the platform to simplify the UI.
- An HTTP return from Stripe, a clicked “Pay” button, a redirect query parameter or a browser event is not booking confirmation. The server's persisted state is authoritative.

### Authorization and state

- Keep three database connections/roles: pooled `app_user` for tenant traffic under RLS, pooled `auth_user` for Auth.js identity tables, direct owner connection only for migrations/seeds. Never grant a broader role to make analytics or draft recovery convenient.
- Every new tenant table gets deny-by-default RLS policies and raw-SQL adversarial tests in the same append-only migration. Every tenant query uses `tenantQuery`/`withMember`; transaction-local `app.user_id` must not leak between pooled requests.
- Existing protected state changes remain enumerated `SECURITY DEFINER` functions. Clients cannot write booking, escrow, payout, claim, review-publication or message-read state directly. Keep audited escrow transitions and Stripe-event idempotency.
- Preserve booking statuses: `pending_payment`, `confirmed`, `checked_in`, `completed`, `canceled_by_guest`, `canceled_by_host`, `expired`.
- Preserve escrow states: `scheduled`, `held`, `claim_window`, `released`, `claimed`, `disputed`, `arbitrated`. In particular: scheduled → held → claim_window; then released with no claim, or claimed → released on acceptance, or claimed → disputed → arbitrated. Cancellation and expiry use existing permitted functions.
- Preserve claim states: `open`, `guest_accepted`, `guest_disputed`, `arbitration`, `resolved_host`, `resolved_guest`, `resolved_split`. Render only server-permitted actions; a friendly label does not create a new transition.
- Separate member intent (`renter`, `homeowner`, `unknown`) from authorization. A member may rent and host. Existing profile flags and ops/arbiter permissions must not be changed by clicking an acquisition CTA.

## 5. Proposed contracts and migration decisions

### A. Safe continuation and same-device recovery

Create `src/lib/continuation.ts` with one tested normalization function. Accept only same-origin, known application destinations, reject `//`, encoded/backslash variants, absolute external URLs and malformed values, and forbid auth-loop destinations. Keep only an allowlist of route-specific query fields. Never concatenate an unchecked `next` into an origin. Generate callback URLs with the URL API and separately validate the callback on the server's Auth.js redirect boundary.

Proposed login URL shape: `/login?next=<encoded local path>&intent=homeowner&source=homeowner_hero`. `intent` and `source` are bounded attribution labels, not privileges. Put these labels inside a validated callback continuation so email returns preserve them; do not trust a client claim of “new user.” A short-lived signed continuation state may be used for attribution if it carries no private draft. Auth tokens remain Auth.js-managed httpOnly/session/email values and are never copied into analytics or local storage.

For renter selections, add a guarded localStorage utility (proposed `src/lib/drafts.ts`):

```json
{
  "schemaVersion": 1,
  "kind": "booking_selection",
  "draftId": "random-opaque-id",
  "listingId": "uuid",
  "checkIn": "2026-11-01",
  "checkOut": "2026-12-01",
  "guests": 2,
  "updatedAt": "ISO timestamp",
  "expiresAt": "ISO timestamp"
}
```

Default retention proposal: 24 hours. Store only listing id, dates and guest count; no email, name, message, address, payment secret, session token, identity document or payment details. Dates are travel preferences: keep them local, time-limited and out of analytics. Use a `draftId` pointer in the internal continuation, not the draft payload. Validate every field, version and expiry; storage exceptions must degrade to a clear “Your selections could not be saved on this device” message without preventing sign-in. Different tabs use distinct draft IDs. Restore into the **review** step, reload listing/config/availability, and announce any changed rate, capacity or availability before continuing.

This works across refreshes and new tabs **in the same browser/origin**, not across devices, private contexts or different browsers. Email copy must say “To keep your selections, open this link in the browser where you started.” On another device, sign-in still succeeds and opens the intended listing/host destination; explain that unsaved selections are unavailable and invite re-entry. Do not claim seamless cross-device draft recovery unless a later, owner-scoped server draft is implemented. Clear local selections on successful conversion, explicit discard, expiry and sign-out/account change as appropriate; never expose one member's draft to another signed-in member on a shared browser.

For homeowners before a valid server listing exists, retain only non-sensitive wizard selections such as listing type, city/country, capacity and last completed step. Keep private address, freeform description and uploaded file bytes out of anonymous persistent storage. Save private details only after authentication in the owner-protected server draft. After a server draft exists, its listing ID allows authenticated cross-device recovery through the owner-read API.

### B. Homeowner data contract

The current create API requires `title`, `type`, `city`, `country`, `timezone`, `nightlyRateCents`, `depositCents` and `maxGuests`. It is **not** a partial-draft endpoint. Optional write fields already supported on the server are `description`, `addressLine`, `region`, `lat`, `lng`, `amenities`, `instantBook`, `cancellationPolicy` and `status`.

Initial build decision: collect valid required values, then call the existing create endpoint with explicit `status: "draft"` exactly once. Do not invent prices, titles or an arbitrary time zone to satisfy validation. The browser's time zone can be a suggested value but must be confirmed as the home's time zone. After creation, save step changes with PATCH. Partial, pre-create choices are local and explicitly labeled as such.

Canonical five-group sequence: **Basics → Home details (optional) → Price & policy → Photos → Review**. At the end of Price & policy, “Save draft & add photos” sends the first valid create request. On success, replace the route with `/host/listings/:listingId?setup=photos` and continue the same wizard shell using the existing editor route. Photos require that real saved listing ID. Review/publish reflects saved data, not an unsaved local preview. Do not place live upload before initial valid draft creation.

Reuse `api.listing(id)` / `GET /api/listings/:id` and `ListingDetail` to hydrate the full editor. `getListingForViewer` already allows owners to read their own draft/paused homes and returns description, type, address, region and amenities; an endpoint expansion is not necessary for those fields. Verify the caller owns the listing before presenting editing controls, and retain server/RLS ownership enforcement on writes. Keep `HostListing` as the dashboard summary unless a demonstrated need justifies changing it. The current frontend `ListingInput` and detail response do not include `lat`/`lng`; add them only if an actual supported input needs them, through a deliberately scoped contract. Avoid adding a map service for this redesign or broadening public/private data exposure accidentally.

A new server partial-draft table is unnecessary for the initial build. If the product later requires saving an incomplete listing across devices before required fields exist, that is a separate schema/API ticket with an ownership policy and expiry; do not weaken the existing listing schema.

The initial wizard can expose existing fields, photo upload/remove and cancellation choices. Photo reorder, photo captions, bathroom count, home rules, long-stay discounts, availability calendars, pet policies or calendar synchronization must be explicitly marked as new backend work if proposed by a visual spec. Do not present inert controls or send unsupported fields. Existing photo attachment supports append order; no reorder endpoint is present in the baseline.

### C. Quotes, deposit explanation and payment setup

Add a proposed read-only `POST /api/bookings/quote` contract for listing id, valid dates and guest count. Return a server-calculated quote, applicable fee rate, deposit method, cancellation policy, listing time zone and expiry configuration, without reserving dates or returning secrets. Protect it with bounded input validation and rate limits. It is a preview: booking creation must independently revalidate price, availability, capacity and configuration. If totals changed, show the new authoritative values for acceptance rather than using stale client calculations. Existing `POST /api/bookings` remains the authority that creates a hold.

Use `created.quote` after creation, not the pre-create browser quote. Add any missing public display fields deliberately to the response/type, including effective fee basis points if needed. For `card_on_file`, the displayed amount payable now equals `guest_total_cents`; show the incidentals amount separately as a maximum subject to the approved claim process. The $120 × 30-night demonstration therefore shows $3,600 stay + $72 network fee = $3,672 payable, with a separate $300 card-on-file deposit authorization explanation. Never say $3,972 is charged today. For `auth_hold`, distinguish an authorization from a captured charge and use verified timing; do not sum a future hold into an immediate charge. The default 30-night minimum and four-night auth cap select card-on-file, but render the server's method rather than hardcoding that assumption.

PAY-02 must establish processor-correct setup before enabling the redesigned live checkout. Baseline facts: the SetupIntent exists on the host's connected account, its secret is returned, but the browser does not confirm it and the response lacks explicit connected-account context. The building agent must consult current official Stripe documentation for the installed SDK and validate in Stripe test mode. Do not assume a platform Payment Element can automatically save a payment method to a connected-account SetupIntent.

Proposed implementation boundary: keep the existing pending booking and stay destination charge mechanics; add a typed, party-authorized setup/payment continuation contract. Confirm the SetupIntent in its correct connected-account context and have the server retrieve and verify its status, association, account and saved payment method before handing the redesigned client the stay-payment confirmation secret. A possible explicit endpoint is `POST /api/bookings/:id/payment-ready`; its exact name is new, not present today. The response may include the public connected-account ID needed by the SDK, never a secret key. Do not accept the client saying “setup succeeded” as proof. Do not expose a second secret through a public listing endpoint.

Prefer setup followed by stay payment with clear progress and recoverable errors. If current processor constraints require distinct setup and payment Elements, disclose that clearly rather than promising one card entry. Preserve consent for potential off-session claim charges. A browser refresh after setup must retrieve safe status and resume only after ownership, non-expired booking and processor revalidation; secrets are fetched over an authenticated API, never persisted locally. Handle setup success/payment failure, rejected setup, additional authentication, network loss, expired holds and delayed/out-of-order webhooks. Any required new transition or persisted setup marker needs an append-only migration and a narrowly scoped server function; do not mutate protected state from the client. No new booking status is necessary solely to render “Saving your payment method.”

This is a release gate, not a claim that the present integration works. Avoid adding retries that create fresh reservations blindly after an unknown response. Add a party-scoped recovery/status lookup and an idempotent create/retry contract where needed, with duplicate/race tests. Live payment secrets and setup data must stay out of URLs, browser storage, logs and analytics. The existing late-expired-payment refund path requires reconciliation verification; UI success must never hide a paid-but-unconfirmed case.

## 6. Dependency-ordered implementation backlog

Ticket size is intentionally a reviewable slice, not a time estimate. Priority P0 means correctness/security or a core-journey blocker; P1 means full-redesign scope required before broad release. Every ticket inherits the applicable QA in `02-ACCEPTANCE-AND-QA.md`.

| ID | Priority / dependencies | Build scope and file map | Completion evidence |
|---|---|---|---|
| BASE-01 | P0 / none | Compare current HEAD with baseline; inventory routes, API fields, existing tests and deployed feature configuration. Read `CLAUDE.md`, `BUILD_PROMPT.md`, `PREFLIGHT.md`. Record baseline screenshots and test results outside `/design`. | Drift log, route matrix, actual pass/fail/skip results and known runtime unknowns. |
| UI-01 | P1 / BASE-01 | Implement new semantic tokens and responsive system in `src/index.css`, `tailwind.config.*`, new `src/components/ui/*`. Button/link/input/select/textarea/field error, dialogs/drawers, toast/status, skeleton/empty state, cards, chips and data rows. Use package design tokens. | Component state gallery, keyboard focus, contrast and mobile/desktop screenshots. No changes to money or auth. |
| NAV-01 | P0 / UI-01 | Rework `Shell.tsx`, `BottomNav.tsx`, `HostSubnav.tsx`, `SkipLink.tsx`, `App.tsx`. Public, renter, homeowner and ops navigation; clear mode switch; working mobile header; titles/focus on navigation. Preserve URLs. | Route/deep-link matrix, signed-out/authenticated nav tests and no hidden primary action at small widths. |
| INT-01 | P0 / BASE-01 | Build safe continuation helper; redesign `Login.tsx`; update `server/auth.ts`, `src/lib/api.ts`, `useAuth.ts` as needed. Explicit send/sent/resend/edit-email/expired-invalid/already-signed-in/session-error states. | Allowed/rejected redirect tests and real email-link lifecycle in a safe test environment. Auth outage is not treated as definitive signed-out state. |
| INT-02 | P0 / NAV-01, INT-01 | Update every protected-page sign-in CTA and `Shell.tsx` to preserve its route and persona intent. Add `/for-homeowners`, `/host/start` to `App.tsx` with purposeful CTAs. | Signed-out “List your home” returns to homeowner creation; renter/trip/message/review deep links return to the same resource. |
| INT-03 | P0 / INT-01 | Add draft utility, safe storage failure behavior, checkout and pre-create host selection persistence in `Book.tsx` / new host-start components. Clear on discard/expiry/account change. | Same-browser new-tab recovery, cross-device fallback, corrupt/expired draft and multi-tab cases. Server revalidation is visible. |
| PAY-01 | P0 / BASE-01 | Correct quote and deposit representation in `Book.tsx`, `PriceBreakdown.tsx`, `EscrowTimeline.tsx`, `ListingDetail.tsx`, `TripDetail.tsx`, associated types/API. Add server quote endpoint and effective fee/deposit metadata as needed. | Server totals match every label and CTA; historical snapshot tests; card-on-file is not described as money held. |
| PAY-02 | P0 / PAY-01, INT-03 | Bounded Stripe test-mode investigation followed by connected-account SetupIntent completion, server verification, payment continuation and retry recovery. Map `server/routes/bookings.ts`, `server/lib/stripe.ts`, `src/pages/Book.tsx`, `src/lib/types.ts`, `src/lib/api.ts`, required migrations. | Processor flow trace and automated tests covering setup/payment/error/retry/expiry paths. Live flag stays off until verified. No platform-MOR fallback. |
| ACQ-01 | P1 / UI-01, NAV-01, INT-02 | Redesign `Landing.tsx` and new homeowner page: concise promise, two clear paths, 30-night floor, honest fees/protections, concrete next action, relevant FAQs. Update `FeeCompare.tsx` only if retained and supported by verified inputs. | User can identify both paths immediately. No fabricated testimonials, earnings or unverifiable trust claims. All CTA destinations work. |
| RENT-01 | P1 / UI-01, NAV-01, PAY-01 | Redesign `Explore.tsx`, `ExploreFilters.tsx`, `ListingCard.tsx`, `ListingDetail.tsx`, `src/lib/filters.ts`. Responsive results, supported filters, URL state, galleries, details and sticky booking action. | Empty/loading/error/one-result states, back/forward filter persistence, valid filters, image fallbacks and guest/date transfer. No unsupported sorting/filter controls. |
| RENT-02 | P0 / RENT-01, INT-03, PAY-02 | Complete booking UI, sign-in interruption, authoritative review, setup/payment, processing and trip handoff. Refactor `Book.tsx` into focused components without altering server state rules. | Full signed-out-to-confirmed journey in test mode with correct amount, no lost selection and webhook-delayed processing state. |
| HOST-01 | P0 / BASE-01 | Hydrate editor from existing `api.listing(id)` / `ListingDetail`, verify owner, and add round-trip contract tests. Keep dashboard summary distinct from editor detail. Reuse existing fields/validation; no partial-draft schema shortcut. | Existing full listings round-trip without field loss; another member cannot read a draft or edit another's listing; invalid values rejected. |
| HOST-02 | P1 / UI-01, INT-02, INT-03, HOST-01 | Build `/host/start` wizard and redesign `HostListingEdit.tsx`, `HostListings.tsx`: essentials, price/cancellation, photos, review, publish/payout next steps. Required-fields-first server draft, saved/error indicators and resume. | Create exactly one draft; refresh/cross-device resumes saved server fields; safe uploads; edit and publish validate real data. |
| HOST-03 | P0 / HOST-02 | Redesign `HostPayouts.tsx` and readiness UI using `api.connectStatus`, `/api/connect/onboard` and `server/routes/connect.ts`. Distinguish listed, account submitted, charge-enabled and payout-enabled. | Return/refresh link recovery, pending/restricted/configuration-failure states; no invented activation on `?done=1`. |
| LIFE-01 | P1 / UI-01, NAV-01, PAY-01 | Redesign `Trips.tsx`, `TripDetail.tsx`, `CancellationPolicyCard.tsx`, `EscrowTimeline.tsx`. Show server state, dates, money, next action and audit-derived timeline; recover expired/payment-processing cases. | Complete lifecycle and cancellation preview/action tests; no fake countdown or “released” state before server transition. |
| LIFE-02 | P1 / UI-01, NAV-01, INT-02 | Redesign `Messages.tsx`, `Passport.tsx`, `Review.tsx`, `TrustPassportCard.tsx`. Contextual inbox, send/retry, reputation explanation, accessible review flow. | Party visibility, unread state, unsent text recovery during transient errors, published/draft review rules. No persistent private message drafts without a separate privacy-conscious design. |
| SAFE-01 | P0 / UI-01, NAV-01, LIFE-01 | Redesign `HostClaims.tsx`, `HostClaimDetail.tsx`, `Ops.tsx` with explicit status/action hierarchy, evidence and irreversible-action review. Preserve party/arbiter/ops gates and existing endpoints. | Illegal transitions/unauthorized users cannot act, open chargeback restrictions visible, exact amount/actions confirmed before submission. |
| MEAS-01 | P1 / INT-01, HOST-01, PAY-01 | Implement vendor-neutral typed event contracts and consent-aware client adapter. Add durable server facts/attribution per `03-MEASUREMENT.md`, with explicit migrations, RLS/grants and idempotent reconciliation. | First-time verified signup is distinct from email sent and returning auth; browser cannot forge activation; no secrets/PII in payloads. |
| QA-01 | P0 / all applicable tickets | Expand browser projects/route tests, core-journey tests, component a11y checks and visual snapshots; retain domain tests. Update copy-coupled smoke assertions to purposeful accessible roles and outcomes. | Required suite passes in real test DB, Stripe test-mode gate passed, manual matrix and limitations recorded. |
| REL-01 | P0 / QA-01, MEAS-01 | Stage release with compatible schema, independent UI flags if useful, monitoring dashboard/query bundle, known-issues log and rollback runbook. Follow `docs/deploy.md` and `docs/backup-restore.md`. | Reviewable PRs, before/after evidence, exact deployment artifact, rehearsal and operator launch decision. |

### Suggested execution order

1. Baseline, invariants and shared system: BASE-01 → UI-01/NAV-01, while HOST-01 and PAY-01 investigate contracts.
2. Journey correctness: INT-01 → INT-02/03 and PAY-02. No redesign conversion claim before this foundation works.
3. Public/renter path: ACQ-01 → RENT-01 → RENT-02; wire initial client measurement.
4. Supply path: HOST-02 → HOST-03; complete server-attributed measurement.
5. Member/operations surfaces: LIFE-01/02 and SAFE-01.
6. End-to-end audit: QA-01 → REL-01. All existing routes must be covered before calling the full redesign done.

Independent tasks may run in parallel only with clear file ownership. Avoid simultaneous edits to `App.tsx`, shared types, global CSS or migrations without a designated integrator. Every merge restores a passing build; do not hand a downstream agent a branch that only works with another unmerged branch.

## 7. Release and rollback

1. Produce a staging build from the exact reviewed commit. Keep secrets in the deployment's existing secret management, never in the ZIP, fixtures, screenshots or issue descriptions. Run migrations against a disposable database first and review actual grant/policy changes.
2. Prefer additive, backward-compatible columns/endpoints and append-only migrations. Old and new UI should tolerate the intermediate schema during rollout. Do not mix a redesign deploy with destructive schema cleanup.
3. Validate real email-link delivery, S3 upload and Stripe test-mode setup/payment using approved test accounts. Verify configured crons, pending-payment expiry, webhook signatures, host readiness and latest successful heartbeat. Mock tests alone do not authorize a live checkout claim.
4. Establish measurement before changing traffic. Roll out by coherent journey/flag if infrastructure supports it: internal test cohort, limited real cohort, then broad release after guardrails hold. Do not split a single checkout across incompatible versions on refresh.
5. Monitor auth sends/verified completions, callback errors, draft restore failures, checkout creation/conflicts, setup/payment failures, pending bookings, webhook delay, refund reconciliation, host readiness failures and client exceptions. Never log secrets or private free text.
6. Roll back immediately for unauthorized data access, incorrect charge/copy mismatch, duplicate/incorrect financial transitions, broken core auth continuation or unrecoverable draft/booking loss. For conversion movement, use the predeclared cohort/sample decision rules; do not rollback on a handful of noisy sessions.
7. Rollback the UI/release flag or deploy the prior compatible artifact. Keep already-created bookings and saved drafts intact. Leave safe additive migrations in place; do not reverse paid transactions or delete user data as a code rollback. For a payment integrity incident, disable new payment entry, preserve read access to trips and follow the existing operations/reconciliation process.
8. After rollback, verify the old UI works against the new additive schema and that background jobs remain healthy. Record affected release ID, time window, reason, recovery checks and any user action needed. A server code rollback does not replace checking the financial ledger.

## 8. Definition of done

- Every route in the screen specification has implemented desktop/mobile layouts, real data wiring and all required states; no production CTA is a mock or dead end.
- Renter selection survives email sign-in in the promised same-browser scope; homeowner intent and saved server drafts resume correctly.
- The actual server charge equals the visible payable amount. Deposit method, payment status, cancellation result and payout readiness are truthful. Processor-dependent paths have test-mode evidence.
- Typecheck, builds, unit/domain tests, full database/RLS tests and required browser journeys pass. Any skipped/environment-dependent tests are enumerated; a skipped gate cannot be called complete.
- Keyboard, screen-reader, contrast, zoom, reduced-motion and responsive checks pass on the agreed matrix. Performance budgets are measured, not merely asserted.
- Attribution separates first-time verified signup, returning auth and both activation paths, with durable/deduplicated server facts and documented unknown attribution.
- The final handoff includes commits/PRs, test evidence, migration notes, screenshots, feature configuration, live-integration verification, residual limitations and rollback instructions. Production launch is a separate operator decision.
