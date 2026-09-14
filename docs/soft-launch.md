# Soft Dist — first-user path and Nick-gates

Stead production is [openstead.app](https://openstead.app). Slices 1–8 and the
2026-09 redesign (BASE→QA) are on `main`. The catalog is empty on purpose:
there are no real hosts yet, and Slice 1 demo homes are hidden unless
`ALLOW_DEMO_LISTINGS=1` (never set on Production). Soft Dist is a **host-led**
launch. An empty Explore is honest, not a defect.

This is REL-01. PAY-02 stays held. Do not seed production. Do not run
`npm run db:migrate` against Neon without Nick.

Deploy mechanics: [`docs/deploy.md`](deploy.md). Rollback:
[`docs/backup-restore.md`](backup-restore.md). Redesign QA record:
[`docs/redesign/QA-01-verification.md`](redesign/QA-01-verification.md).

## Expected states

| State | What a visitor sees | What is true |
| --- | --- | --- |
| **Empty marketplace** (today) | Landing inventory and `/explore` say “No homes are listed right now.” Two actions: **List your home** → `/for-homeowners`, **Start your listing** → `/host/start`. No demo cottages, no invented ratings. | Seed ids are hidden. Zero published real homes. |
| **First host, draft** | Explore still empty. `/host/listings` shows the draft. Only that member can open it. | `POST /api/listings` wrote `status: draft`. Nothing is bookable. |
| **First host, published, payouts not ready** | The home appears on Explore. Book / Reserve stays closed (same kill-switch). Checkout would also fail closed without a host Connect `acct_`. | Publishing and payout-ready are different facts. Bookings stay off until Nick enables them. |
| **First host, published + Connect ready** | The home is listed. **Book / Reserve stays closed** until Nick sets `ALLOW_GUEST_BOOKINGS=1`. Guests see “Not open for bookings yet” — no Payment Element. | Soft Dist has no live rentals until that flag. Launch criterion after the flag: required geo-proven home scan (separate Phase — not this PR). PAY-02 still held. |

Leftover search params (`/explore?q=Hudson`) on an empty catalog still show the
host-led empty state, not “No homes match these filters.”

## Dist smoke path (signed-out → first draft)

Do this on [openstead.app](https://openstead.app) in a private window. Do **not**
set `ALLOW_DEMO_LISTINGS`. Do **not** run `db:seed`.

1. **Signed-out Explore.** Open `/explore`. Expect “No homes are listed right now.”
   Expect **List your home** and **Start your listing**. No seed cards.
2. **Acquisition.** Click **List your home**. Land on `/for-homeowners`. Copy
   states the 30-night floor and that a home starts as a draft.
3. **Setup, still signed out.** Click **Start your listing**. Land on
   `/host/start`. Expect “Sign in to save your home as a draft” and
   **Continue with your email** →
   `/login?next=%2Fhost%2Fstart&intent=homeowner&source=homeowner_hero`.
4. **Magic link.** Enter a real inbox. Resend Pro SEND smoke has already passed;
   **session confirm is waiting on Nick opening the Gmail link** in the same
   browser. The link’s `callbackUrl` is `/host/start` (allowlisted). After
   sign-in, `/login` offers “Continue your listing.”
5. **Draft, no seed.** On `/host/start`, fill Basics → skip or complete Home
   details → Price and terms → **Save draft and add photos**. Expect a real
   draft id at `/host/listings/:id?setup=photos`. Explore remains empty until
   the host publishes. Photos need S3; they can wait.
6. **Do not book.** Guest create-booking is hard-blocked until Nick sets
   `ALLOW_GUEST_BOOKINGS=1` on Vercel Production. A published home without
   Connect still cannot take a live stay charge. Do not treat a mock-payment
   laptop run as Dist checkout.

Automated coverage for steps 1–3 (empty catalog stubbed, so leftover e2e seed
rows cannot hide it): `e2e/ui.spec.ts` —
`empty explore offers a host-led first-user path`. Wizard draft creation is
`listing creation (HOST-02)` in the same file, against a host with no listings.

### Same browser vs another device

The magic link itself carries `/host/start`. Open it in the browser that
requested the link when you can: pre-create essentials live in that device’s
storage (name, type, city, country, time zone, capacity — never rate, deposit,
address, or description). Another device still signs in and lands on
`/host/start`; the form is blank and can be filled again.

## Nick-gates (Soft Dist)

| Gate | Status | Why it blocks Dist |
| --- | --- | --- |
| **Magic-link session confirm** | SEND smoke PASS (Resend Pro). Waiting on Nick to open the Gmail link and confirm the session cookie. | Without a confirmed session, the first host cannot save a draft. |
| **Connect platform profile** | Still required for Express Account Links (PREFLIGHT §3). | `/host/payouts` → Continue to Stripe 503s until the Dashboard platform profile exists. Live stay charges already fail closed without a host `acct_`. |
| **Guest bookings (`ALLOW_GUEST_BOOKINGS`)** | **Off on Production.** Unset or `0` refuses create-booking fail-closed. | Soft Dist has **no live rentals** until Nick flips `ALLOW_GUEST_BOOKINGS=1` on the Vercel Production environment. Quote stays read-only. Book / Reserve shows “Not open for bookings yet” (no Payment Element). **Launch criterion:** required geo-proven home scan ships first (Next Phase — plan only, no scan code here). Then Nick turns bookings on. |
| **PAY-02** | **Held. Do not start.** | Connected-account SetupIntent is created and returned; the browser does not complete it. No verified test-mode deposit setup / payment recovery. Do not claim live checkout. |
| **No seed on production** | By design (`#24`). | Empty inventory is honest. Never set `ALLOW_DEMO_LISTINGS` on Production. `npm run db:seed` refuses `openstead.app`. |
| **`bookings_min_stay` NOT VALID** | Leftover. | `drizzle/0003_regulatory_min_stay.sql` adds `CHECK (nights >= 30)`. If Neon still shows the constraint `NOT VALID`, validating it is an owner operation on existing rows — Nick-gated. App quote and create-booking already reject `< 30`. **Do not `db:migrate` blindly.** |
| **Manual QA matrix** | Not performed. | Screen reader, real devices, measured contrast, photo upload, Connect onboarding, reduced motion: [`docs/redesign/QA-01-verification.md`](redesign/QA-01-verification.md) §4. |
| **Cron on Hobby** | Unchanged. | `expire-pending` is not in `vercel.json`. Production needs an external scheduler (`docs/deploy.md`). |

### Next Phase

Honesty media (required geo-proven host scan before a home is bookable): [`BUILD-PLAN.md`](honesty-media/BUILD-PLAN.md). Claude Code on that branch: [`START-HERE-CLAUDE-CODE.md`](honesty-media/START-HERE-CLAUDE-CODE.md).

## What this PR does not do

- Geo-proven home scan pipeline (Next Phase; launch criterion only — [`BUILD-PLAN.md`](honesty-media/BUILD-PLAN.md)).
- PAY-02 (held).
- Any `drizzle/` change or Neon migrate.
- Reintroducing seed homes as bookable.
- Edits under `/design`.
- Claiming Postmark is live; Dist mail send is Resend Pro until Nick says otherwise.

Copyright 2026 Stead contributors.
