# Progress

Spec of record: `BUILD_PROMPT.md` (stack amendment at the top). One slice at a time. A slice is done when its acceptance criteria pass and `npm run typecheck` + `npm test` are green.

| Slice | Status | Notes |
| --- | --- | --- |
| S1 Foundation + guest booking | Done on `main` | Auth.js magic link, seed, `/explore`, `/listing/:id`, create-booking, `/trips`. Pricing + overlap + expire-pending tests. |
| S2 Escrow lifecycle | Done on `main` | Check-in / checkout / release crons, auth_hold + card_on_file, EscrowTimeline, heartbeats, legal + illegal transition tests. |
| S3 Host + claims | Done on `main` | Listing CRUD + photos, Connect Express, instant payout, claims with evidence, arbiter resolution. |
| S4 Reviews + Trust Passport | Done on `main` | Double-blind reviews, `trust_stats`, TrustPassportCard, signed export + verify, `host_cancellations` on the passport. |
| S5 Landing + polish | Done on `main` | Landing from `/design` with a live fee slider; explore filters; branded email templates; a11y polish. |
| **S6 Messaging + cancellations** | **This branch** | Threads, unread badges, email notify; cancellation engine + policy preview on listing, checkout, and trip. |
| S7 Trust & safety | Not started | Stripe Identity, chargeback freeze/unfreeze, review reminders, admin ops, watchdog. |
| S8 Production readiness | Not started | Playwright e2e, rate limiting, deploy pipeline docs, backup/restore. |

## Slice 6 acceptance

- `/messages` lists threads keyed by `(listing_id, guest_id)`. Guests may write before they book. Unread badges on Inbox and on each thread. `send-message` emails the recipient.
- Guest cancel follows BUILD_PROMPT §6 relative to listing-local check-in: flexible / moderate / strict exactly. Deposit always released. `refunds` row for every refund. Host cancel is 100% including the fee, dates blacked out, `host_cancellations` increments, both sides emailed.
- `/trips/:bookingId` shows the exact refund before confirm. Policy copy is on the listing and on checkout.
- Vitest: full refund matrix per policy × timing; cancel-booking writes; adversarial RLS on messages.

## Out of scope (HARD STOP)

Stripe Identity, chargebacks, review reminders, admin ops, watchdog, Playwright, and anything in S7–S8.
