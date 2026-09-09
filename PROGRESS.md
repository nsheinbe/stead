# Progress

Spec of record: `BUILD_PROMPT.md` (stack amendment at the top). One slice at a time. A slice is done when its acceptance criteria pass and `npm run typecheck` + `npm test` are green.

| Slice | Status | Notes |
| --- | --- | --- |
| S1 Foundation + guest booking | Done on `main` | Auth.js magic link, seed, `/explore`, `/listing/:id`, create-booking, `/trips`. Pricing + overlap + expire-pending tests. |
| S2 Escrow lifecycle | Done on `main` | Check-in / checkout / release crons, auth_hold + card_on_file, EscrowTimeline, heartbeats, legal + illegal transition tests. |
| S3 Host + claims | Done on `main` | Listing CRUD + photos, Connect Express, instant payout, claims with evidence, arbiter resolution. |
| S4 Reviews + Trust Passport | Done on `main` | Double-blind reviews, `trust_stats`, TrustPassportCard, signed export + verify, `host_cancellations` on the passport. |
| S5 Landing + polish | Done on `main` | Landing from `/design` with a live fee slider; explore filters; branded email templates; a11y polish. |
| S6 Messaging + cancellations | Done on `main` | Threads, unread badges, email notify; cancellation engine + policy preview on listing, checkout, and trip. |
| **S7 Trust & safety** | **This branch** | Stripe Identity → tier 2; chargeback freeze/unfreeze; review reminders; minimal ops view; watchdog. |
| S8 Production readiness | Not started | Playwright e2e, rate limiting, deploy pipeline docs, backup/restore. |

## Slice 7 acceptance

- Stripe Identity: signed-in member starts a VerificationSession from their own Trust Passport. `identity.verification_session.verified` sets `id_verified`; `trust_stats.verification_tier` becomes 2. Members cannot write `id_verified`.
- Chargebacks: `charge.dispute.created` inserts `stripe_disputes` and freezes payouts for that booking; escrow release and claim transitions pause while the dispute is open. `charge.dispute.closed` updates the row and unfreezes on won / warning_closed / prevented.
- Review reminders: cron at day 3 and day 7 after listing-local checkout if that party has not submitted; stops at 14 days.
- `/ops` (utilitarian, not in `/design`) shows disputes, heartbeats, frozen payouts. Gated by `profiles.is_ops`.
- Daily `/api/cron/watchdog` emails `OPS_ALERT_EMAIL` when any heartbeat is stale or errored; also retries expired-and-paid refunds the webhook missed.
- Vitest: dispute freeze/unfreeze, identity tier, reminder cadence, watchdog evaluation, adversarial RLS on the new tables.

## Out of scope (HARD STOP)

Playwright e2e, edge rate limiting, full RLS suite beyond the new probes, deploy pipeline docs, backup/restore runbook — those are Slice 8.
