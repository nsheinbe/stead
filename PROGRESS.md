# Progress

Spec of record: `BUILD_PROMPT.md` (stack amendment at the top). One slice at a time. A slice is done when its acceptance criteria pass and `npm run typecheck` + `npm test` are green.

| Slice / ticket | Status | Notes |
| --- | --- | --- |
| S1 Foundation + guest booking | Done on `main` | Auth.js magic link, seed (local/staging), `/explore`, `/listing/:id`, create-booking, `/trips`. |
| S2 Escrow lifecycle | Done on `main` | Check-in / checkout / release crons, auth_hold + card_on_file, EscrowTimeline. |
| S3 Host + claims | Done on `main` | Listing CRUD + photos, Connect Express, instant payout, claims, arbiter. |
| S4 Reviews + Trust Passport | Done on `main` | Double-blind reviews, Trust Passport, signed export + verify. |
| S5 Landing + polish | Done on `main` | Landing, explore filters, branded email, a11y polish. |
| S6 Messaging + cancellations | Done on `main` | Threads, unread badges, cancellation engine + policy preview. |
| S7 Trust & safety | Done on `main` | Stripe Identity → tier 2, chargeback freeze, review reminders, ops, watchdog. |
| S8 Production readiness | Done on `main` | Playwright, rate limits, RLS matrix, Vercel + Neon docs, backup/restore. Last BUILD_PROMPT slice. |
| Redesign BASE-01 → QA-01 | Done on `main` | `#22` (BASE/UI/NAV/INT/PAY-01) and `#23` (renter, homeowner, lifecycle, safety, measurement, QA record). |
| Seed-hide | Done on `main` | `#24` — Slice 1 demo ids hidden from production Explore and booking. |
| REL-01 Soft-launch readiness | This branch | Dist first-user path, `docs/soft-launch.md`, Nick-gates. **PAY-02 not started.** |
| Honesty media — design fill (HM-D00…D13) | `codex/claude-code-handoff-2026-09-14` | Docs only: `design/honesty-media/` screens, locked copy, decisions. No app code; implementation starts at HM-00 on a new branch when Nick asks. |
| HM-00 Honesty policy + copy | `claude/hm-00-honesty-policy` | `src/lib/honestyCopy.ts` locked strings, ban-list test, `docs/honesty-media/POLICY.md`, one-line mentions on `/for-homeowners` and `/host/start`. No schema, no scan code, kill-switch untouched. |

## Production (`openstead.app`)

Live. Catalog is empty by design: no real hosts, seed ids hidden. Soft Dist is host-led — an empty Explore is honest.

- Resend Pro magic-link **SEND** smoke PASS. **Session confirm waiting on Nick opening the Gmail link.**
- Host-led path: empty Explore → List your home → `/for-homeowners` → `/host/start` → magic link resumes setup → draft listing, no seed inventory.
- Smoke and gates: [`docs/soft-launch.md`](docs/soft-launch.md).

## REL-01 acceptance

- Signed-out empty Explore (including leftover `?q=`) shows the host-led empty state, not a filter miss. CTAs: **List your home** (`/for-homeowners`) and **Start your listing** (`/host/start`).
- Magic-link continuation to `/host/start` unchanged and covered: allowlist + HostStart sign-in card + login context. Same-browser open keeps local essentials; another device still lands on setup.
- A signed-in host can create a draft via `/host/start` with zero published homes (HOST-02 e2e).
- Dist smoke, empty vs first-host states, and Nick-gates documented in `docs/soft-launch.md`.
- Playwright: empty catalog stub → Explore CTAs → `/for-homeowners` → `/host/start` → email continuation href.

## Known leftovers / Nick-gates (Soft Dist)

| Item | Status |
| --- | --- |
| **Guest bookings** | **Off.** `ALLOW_GUEST_BOOKINGS` unset on Production — create-booking refuses. Nick flips it on Vercel when ready (after required geo-proven scan). |
| **PAY-02** | **Held.** Connected-account SetupIntent not completed in the browser. Do not start. |
| **Connect platform profile** | Still required before Express Account Links work (PREFLIGHT §3). |
| **Magic-link session confirm** | Send passed; Nick Gmail click outstanding. |
| **No seed** | Production stays empty until a real host publishes. Never `ALLOW_DEMO_LISTINGS` on Production. |
| **`bookings_min_stay` NOT VALID** | App already rejects `< 30` nights. Validating the Postgres check is Nick-gated. No blind `db:migrate`. |
| **Manual QA matrix** | Not performed — see QA-01 §4. |
| **Cron on Hobby** | `expire-pending` is not in `vercel.json`; Production needs an external scheduler. |

## Slice 8 acceptance (unchanged)

- Playwright: `e2e/lifecycle.spec.ts`, `e2e/cancel.spec.ts`; live Stripe gated on `STRIPE_E2E=1`. How to run: `docs/e2e.md`.
- Rate limiting on the write paths listed in BUILD_PROMPT; webhook not limited.
- RLS isolation matrix in `tests/rls.test.ts`.
- Deploy: `docs/deploy.md`. Backup/restore: `docs/backup-restore.md`.

## Out of scope (HARD STOP)

S1–S8, redesign BASE→QA, seed-hide, and this REL-01 PR. **PAY-02 is held.** No new product slice.
