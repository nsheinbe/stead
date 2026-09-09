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
| S7 Trust & safety | Done on `main` | Stripe Identity → tier 2; chargeback freeze/unfreeze; review reminders; ops view; watchdog. |
| **S8 Production readiness** | **This branch** | Playwright e2e, rate limiting, cross-role RLS matrix, Vercel + Neon deploy docs, backup/restore runbook. Last BUILD_PROMPT slice. |

## Slice 8 acceptance

- Playwright: `e2e/lifecycle.spec.ts` (book → check-in → checkout → release) and `e2e/cancel.spec.ts` (cancel-with-refund) against the running app with mock Stripe. `e2e/stripe.live.spec.ts` is gated on `STRIPE_E2E=1` + `sk_test_` keys. Wired as `npm run test:e2e` and in CI after the production build. How to run: `docs/e2e.md`.
- Rate limiting on create-booking, cancel, send-message, file/respond/resolve-claim, and Identity session. Webhook is not limited (idempotent via `stripe_events`). Process-local sliding window; documented as such.
- RLS: existing adversarial suite plus a guest A / guest B / host / arbiter / ops / anonymous isolation matrix in `tests/rls.test.ts`.
- Deploy pipeline: `docs/deploy.md` — Vercel + Neon branches, the three role URLs, webhooks, crons. Not staging/prod Supabase.
- Backup/restore: `docs/backup-restore.md` — Neon history window + `pg_dump`, and the S3 bucket as a separate restore.

## Out of scope (HARD STOP)

This is the last BUILD_PROMPT slice. No Slice 9.
