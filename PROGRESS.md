# Progress

Spec of record: `BUILD_PROMPT.md` (stack amendment at the top). One slice at a time. A slice is done when its acceptance criteria pass and `npm run typecheck` + `npm test` are green.

| Slice | Status | Notes |
| --- | --- | --- |
| S1 Foundation + guest booking | Done on `main` | Auth.js magic link, seed, `/explore`, `/listing/:id`, create-booking, `/trips`. Pricing + overlap + expire-pending tests. |
| S2 Escrow lifecycle | Done on `main` | Check-in / checkout / release crons, auth_hold + card_on_file, EscrowTimeline, heartbeats, legal + illegal transition tests. |
| S3 Host + claims | Done on `main` | Listing CRUD + photos, Connect Express, instant payout, claims with evidence, arbiter resolution. |
| S4 Reviews + Trust Passport | Done on `main` | Double-blind reviews, `trust_stats`, TrustPassportCard, signed export + verify, `host_cancellations` on the passport. |
| **S5 Landing + polish** | **This branch** | Landing from `/design` with a live fee slider; explore filters; branded email templates; a11y polish aimed at Lighthouse ≥ 90. |
| S6 Messaging + cancellations | Not started | Threads, unread badges, cancellation engine + policy preview. Hard stop: do not start here. |
| S7 Trust & safety | Not started | Stripe Identity, chargeback freeze/unfreeze, review reminders, admin ops, watchdog. |
| S8 Production readiness | Not started | Playwright e2e, rate limiting, deploy pipeline docs, backup/restore. |

## Slice 5 acceptance

- `/` is the marketing landing (no longer a redirect to `/explore`). Nine sections match `/design`: hero, fee math, deposit escrow, Trust Passport, reviews-with-receipts, host payouts, member-owned, FAQ, footer CTA.
- Fee slider is live. Stead's column is `quoteStay` (integer cents). Nights cannot drop below 30. Typical-platform comparison is display-only.
- `/explore` filters by destination, city, type, guests, max nightly rate, and instant book. Filters are query params on `GET /api/listings` and shareable on the URL. RLS still scopes the rows; filters only narrow active listings.
- Transactional email (magic link, deposit release, claims, review-open) uses one branded HTML layout plus a text body. Without `RESEND_API_KEY` the text still prints to the console. No invented secrets.
- Skip link, landmarks, labelled controls, image alt text, focus styles, reduced motion. Photo placeholders remain picsum seeds.

## Out of scope (HARD STOP)

Messaging, cancellations, Stripe Identity, chargebacks, Playwright, and anything in S6–S8.
