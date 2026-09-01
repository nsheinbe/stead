# Stead — Build Prompt v2 (Slices 1–8)

> **Stack amendment (supersedes the Supabase references below).** The prompt
> below is the original brief and the slice plan is unchanged, but the platform
> moved off Supabase onto Neon Postgres. Where it says:
>
> * **Supabase Auth** → Auth.js v5, magic link by email (Resend), session as a
>   JWT in an httpOnly cookie. Google OAuth is still deferred. §11's
>   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
>   are replaced by `DATABASE_URL`, `AUTH_SECRET`, and `CRON_SECRET`.
> * **Postgres with RLS on every table** (§4, §9) → unchanged in substance; the
>   RLS sketch in §4 is live on Neon. What changed is what the policies bind to:
>   there is no PostgREST and no per-request `anon`/`authenticated` role, so the
>   browser holds no database credentials and the member id arrives as the
>   transaction-local `app.user_id`, read by `app.current_user_id()`. Traffic
>   runs as `app_user`; the owner role is migrations-only and the app fails
>   closed rather than serve as a role that can bypass RLS. `auth.users` became
>   `public.users`, and the service role's blanket write access became four
>   enumerated `SECURITY DEFINER` functions. Integer cents, the generated `stay`
>   daterange, and the btree_gist exclusion constraint are untouched.
> * **Edge Functions** (§7) → routes on a Hono API under `/api`, deployed as a
>   Vercel function and runnable standalone with `npm start`. Cron jobs are
>   authenticated HTTP endpoints under `/api/cron/*`.
> * **Supabase Storage** → any S3-compatible bucket via the `S3_*` variables
>   (MinIO locally). Nothing uploads yet; this lands in Slice 3.
> * **§8 deploy pipeline docs (S8)** → Vercel + Neon branches, not staging and
>   prod Supabase projects.
>
> See README "Shape of the thing" for the current layout.

```
You are building **Stead**, a community-owned home rental marketplace
positioned as the fair, trust-first alternative to Airbnb. Read CLAUDE.md
first. Design truth lives in /design (Stead.dc.html + DESIGN_HANDOFF.md with
pre-extracted tokens); match it visually but rebuild components properly —
the export's inline styles are reference, not production markup.

Work slice by slice (§10). Do not start a new slice until the previous
slice's acceptance criteria pass, `npm run typecheck` is clean, and
`npm run test` is green. Ask before adding dependencies not listed here.

## 1. Stack (pinned)
Vite + React 18 + TypeScript strict, Tailwind, React Router, TanStack Query,
react-hook-form + zod, date-fns + date-fns-tz. Supabase: Auth (magic link +
Google OAuth), Postgres with RLS on every table, Storage, Edge Functions for
all money logic and state transitions. Stripe: Payment Element, SetupIntent
card-on-file, manual-capture PaymentIntents for deposit holds, Connect
Express with separate charges and transfers, Stripe Identity (Slice 7).
Resend for email. Vitest from Slice 1; Playwright in Slice 8.
Integer cents everywhere. No floats for money, ever.

## 2. Design system
Use tokens from /design/DESIGN_HANDOFF.md (paper/ink/spruce/brass/linen +
claim red for dispute states only). Ibarra Real Nueva for display headlines
only; Hanken Grotesk for UI; tabular numerals on all money. 16px card radius,
soft single shadows. Trust Passport card carries the guilloché SVG motif.
LANGUAGE RULES (hard requirement for all UI copy, emails, seed data): never
blockchain, crypto, wallet, token, web3, DAO, smart contract, on-chain, gas.
Use: neutral escrow, community-owned, member-owned, portable reputation,
Trust Passport, independent arbitration, instant payout.

## 3. Pricing & policy config (app_config table, key text pk, value jsonb)
network_fee_bps=200 · processing_passthrough=false · claim_window_hours=48 ·
deposit_auth_max_nights=4 · pending_payment_ttl_minutes=30 ·
checkin_local_time="16:00" · checkout_local_time="11:00".
Booking math (server-side only, snapshotted onto the booking):
stay_subtotal = nightly_rate × nights; network_fee = subtotal ×
network_fee_bps/10000; guest_total = subtotal + network_fee. Deposit is
separate and refundable — never summed into guest_total. Example: $200 × 5
nights → guest pays $1,020, host receives $1,000 at check-in, $300 deposit
held apart.

## 4. Database schema (Postgres; RLS on every table; btree_gist extension)
- profiles: id uuid pk → auth.users, display_name, avatar_url, is_host bool,
  phone_verified bool, id_verified bool, member_since timestamptz.
- listings: id, host_id, title, description, type enum('entire_home',
  'apartment','private_room'), address_line, city, region, country, lat, lng,
  timezone text (IANA, required), nightly_rate_cents, deposit_cents,
  max_guests, amenities jsonb, instant_book bool, cancellation_policy enum
  ('flexible','moderate','strict') default 'moderate', status enum
  ('draft','active','paused').
- listing_photos: id, listing_id, storage_path, sort_order.
- listing_blackouts: id, listing_id, start_date, end_date.
- bookings: id, listing_id, guest_id, check_in date, check_out date, guests,
  nights, nightly_rate_cents, stay_subtotal_cents, network_fee_cents,
  guest_total_cents, deposit_cents, cancellation_policy snapshot, status enum
  ('pending_payment','confirmed','checked_in','completed',
  'canceled_by_guest','canceled_by_host','expired'),
  stripe_payment_intent_id, created_at, plus
  stay daterange GENERATED ALWAYS AS (daterange(check_in, check_out,'[)'))
  STORED and constraint:
  EXCLUDE USING gist (listing_id WITH =, stay WITH &&)
  WHERE (status IN ('pending_payment','confirmed','checked_in')).
  Never check-then-insert availability in app code; rely on this constraint
  and surface a friendly conflict error.
- messages: id, listing_id, booking_id nullable, sender_id, recipient_id,
  body, created_at, read_at. Thread key = (listing_id, guest_id). Guests may
  message before booking; RLS restricts to the two participants.
- escrow_deposits: id, booking_id unique, amount_cents, state enum
  ('scheduled','held','claim_window','released','claimed','disputed',
  'arbitrated'), method enum('auth_hold','card_on_file'),
  stripe_setup_intent_id, stripe_auth_pi_id, held_at, window_closes_at,
  released_at, resolved_amount_cents.
- escrow_audit: id, deposit_id, from_state, to_state, actor, at, meta jsonb.
- claims: id, booking_id, filed_by, amount_cents, description, state enum
  ('open','guest_accepted','guest_disputed','arbitration','resolved_host',
  'resolved_guest','resolved_split'), created_at, resolved_at,
  resolution_amount_cents, resolution_note.
- claim_evidence: id, claim_id, uploaded_by, storage_path, note.
- reviews: id, booking_id, author_id, subject_id, direction enum
  ('guest_reviews_host','host_reviews_guest'), rating 1–5, tags text[], body,
  submitted_at, published_at nullable, unique (booking_id, direction).
- payouts: id, booking_id, host_id, amount_cents, stripe_transfer_id, state
  enum('scheduled','paid','frozen','failed'), paid_at.
- refunds: id, booking_id, amount_cents, reason enum('guest_cancel',
  'host_cancel','dispute'), stripe_refund_id, created_at.
- stripe_events: id text pk, type, processed_at (webhook idempotency).
- stripe_disputes: id text pk (Stripe dispute id), payment_intent_id,
  booking_id, amount_cents, status, created_at, closed_at.
- cron_heartbeats: job text pk, last_ok timestamptz, last_error text.
- trust_stats view per profile: stays_completed, damage_free_streak
  (consecutive completed stays as guest with no resolved_host/split claim),
  avg_rating_as_guest, avg_rating_as_host, review_count, response_rate,
  host_cancellations (count of canceled_by_host on own listings — shown on
  the Trust Passport), verification_tier (0 email · 1 +phone · 2 +id),
  member_since.
RLS sketch: active listings/photos public read; hosts CRUD own listings;
booking rows visible to their guest + listing host; escrow/claims/evidence
visible to booking parties + arbiter role; messages to participants only;
reviews public when published_at set; all money/state writes via edge
functions with service role — client writes on those tables denied.

## 5. Escrow state machine (edge functions only; audit every transition)
scheduled→held at listing-local check-in time: nights ≤
deposit_auth_max_nights → manual-capture PI auth (auth_hold; card auths last
~7 days, hence the cap); else card_on_file (no funds held; off-session charge
only on approved claim). held→claim_window at listing-local checkout;
window_closes_at = checkout + claim_window_hours. claim_window→released via
cron when window closes with no open claim (cancel auth if any; email guest).
claim_window→claimed on host claim (amount ≤ deposit, before window close).
claimed→released (guest accepts: capture/charge resolution_amount, transfer
to host, release remainder) or →disputed→arbitrated (arbiter resolves
host/guest/split; capture/charge + transfer accordingly).

## 6. Cancellation engine (server-side; refunds table rows for every refund)
Guest cancels (relative to listing-local check-in):
- flexible: ≥24h → 100% of stay + fee refunded; <24h → first night retained,
  remainder of stay refunded, fee retained.
- moderate: ≥5 days → 100% + fee; <5 days → 50% of stay, fee retained;
  after check-in → no refund (MVP: no mid-stay proration).
- strict: ≥14 days → 100% + fee; 14–7 days → 50% of stay, fee retained;
  <7 days → no refund.
Deposit: always fully released on any cancellation. Payout: if already paid
(post-check-in), refunds come from platform balance — flag negative-balance
risk in a TODO comment; pre-check-in cancels reverse the scheduled transfer.
Host cancels: 100% refund incl. fee, deposit released, dates blacked out,
host_cancellations increments (visible on Trust Passport). Email both sides.

## 7. Edge functions
create-booking (validate, compute money, insert booking pending_payment +
escrow scheduled + SetupIntent + PaymentIntent; return client secrets) ·
stripe-webhook (idempotent; payment_intent.succeeded→confirmed;
charge.dispute.created→insert stripe_disputes + freeze pending payouts and
pause escrow actions for that booking; charge.dispute.closed→update +
unfreeze per outcome; account.updated→host payout readiness) ·
cancel-booking (engine in §6) · run-check-ins (hourly; listing-local 16:00 →
checked_in, deposit hold per §5, Connect transfer of stay_subtotal → payouts
paid) · run-checkouts (listing-local 11:00 → completed, escrow→claim_window,
schedule review reminders) · expire-pending (cancel pending_payment older
than ttl → expired) · close-claim-windows · file-claim / respond-claim /
resolve-claim (arbiter-gated) · publish-reviews (both in → publish; else
14 days after checkout) · export-trust-passport (canonical JSON of
trust_stats signed Ed25519 via PASSPORT_SIGNING_KEY + public verify
endpoint) · send-message. Every cron updates cron_heartbeats; a daily
watchdog emails ops via Resend if any heartbeat is stale or errored.

## 8. Routes (match /design)
Public: / (landing w/ working fee slider), /explore, /listing/:id,
/passport/:userId, /login. Guest: /book/:listingId (3 steps w/ deposit
explainer + escrow timeline), /trips, /trips/:bookingId (deposit chip,
timeline, message host, cancel w/ policy preview showing exact refund before
confirm), /messages, /review/:bookingId. Host: /host (payout balance,
calendar, claims inbox), /host/listings/new+edit, /host/claims/:id,
/messages. Shared: EscrowTimeline, TrustPassportCard, PriceBreakdown
(deposit in dashed "Returns to you" container).

## 9. Non-negotiables
Everything in CLAUDE.md Invariants. Loading/empty/error states everywhere;
visible keyboard focus; reduced motion respected; seed script (1 host, 6
active listings across timezones w/ picsum photos, varied policies) runs
clean on a fresh project.

## 10. Slices
S1 Foundation + guest booking: auth, profiles, seed, /explore, /listing/:id,
  create-booking + Stripe test payment, /trips. Vitest: pricing math table
  tests; overlap test proving the exclusion constraint (2nd overlapping
  booking fails); expire-pending test. Accept: happy path in test mode; RLS
  probe (guest A cannot read guest B's booking).
S2 Escrow lifecycle: check-in/checkout/window/expire crons (listing-local
  time), auth_hold + card_on_file, release + emails, live EscrowTimeline,
  heartbeats. Vitest: every legal + illegal transition. Accept: fast-forward
  booking through held→claim_window→released with audit rows.
S3 Host + claims: listing CRUD + photos, Connect Express onboarding, instant
  payout at check-in, claims w/ evidence, arbiter resolution. Accept: claim
  → dispute → split resolution with correct captures/transfers in Stripe
  test dashboard.
S4 Reviews + Trust Passport: double-blind flow + publish cron, trust_stats,
  TrustPassportCard, signed export + verify. Accept: simultaneous reveal;
  signature verifies; host_cancellations renders on passport.
S5 Landing + polish: build landing from /design (fee slider live), explore
  filters, branded email templates, Lighthouse a11y ≥ 90.
S6 Messaging + cancellations: threads, unread badges, email notify;
  cancellation engine + policy preview UI; policy shown on listing +
  checkout. Vitest: full refund matrix per policy × timing.
S7 Trust & safety: Stripe Identity → verification_tier 2; chargeback flow
  live (freeze/unfreeze); review reminders; minimal admin ops view
  (disputes, stale heartbeats, frozen payouts); watchdog alerts.
S8 Production readiness: Playwright e2e (book→check-in→checkout→release;
  cancel-with-refund), edge-function rate limiting, RLS test suite across
  roles, deploy pipeline docs (staging + prod Supabase projects), backup/
  restore runbook.

## 11. Env vars
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
STRIPE_SECRET_KEY, VITE_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
RESEND_API_KEY, OPS_ALERT_EMAIL, PASSPORT_SIGNING_KEY, APP_URL.

Start with Slice 1. Before writing code, output: migration SQL, RLS
policies, and the Slice 1 file tree — then wait for my go.
```
