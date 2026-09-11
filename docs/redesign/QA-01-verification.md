# QA-01 — what is verified, and what is not

This is the honest inventory for the phase-3 redesign branch
(`redesign/ui-ux-2026-09-phase2`). Its purpose is to be believed, so anything
not actually run is recorded as not run rather than described in a way that
reads like a pass.

## 1. Automated suites

| Suite | Command | Scope |
| --- | --- | --- |
| Types | `npm run typecheck` | Whole repo, `tsc --noEmit`, strict. |
| Domain and API | `npm test` | Vitest. Money math, cancellation, escrow, claims, RLS probes, conversion facts, HTTP contracts against a real Postgres. |
| Browser | `npx playwright test` | Journeys, route matrix, accessibility. Chromium against the built app and a real Postgres. |
| Build | `npm run build` | SPA and API bundle. |

Every one of these requires a database. `DATABASE_URL_OWNER` must point at a
Postgres the harness may migrate and seed; without it the DB-backed blocks
**skip rather than fail**, which is worth knowing before reading a green run.

### Browser projects

* `api` — `lifecycle.spec.ts`, `cancel.spec.ts`, `stripe.live.spec.ts`
* `chromium` — `ui.spec.ts`, `routes.spec.ts`, `a11y.spec.ts`

A new browser spec must be added to `testMatch` in `playwright.config.ts` or it
will be collected by no project and silently never run.

## 2. What the browser suite actually asserts

**Journeys** (`ui.spec.ts`) — landing through search to results; browse and
compare; a home page priced at the minimum stay; contextual sign-in returning
to the exact route; honest money at checkout; cancel with the server's refund
preview; the listing wizard creating exactly one draft and publishing it;
payout readiness never claiming a live account from a return URL; the stay
lifecycle including unconfirmed and expired holds; profiles, messages and
reviews.

**Route matrix** (`routes.spec.ts`) — every static route in both auth states
with the right document title, exactly one `h1`, a `main` landmark and no
uncaught page errors; routes carrying an id; missing ids explained rather than
blank; private routes offering a way in without leaking content; phone width
with no horizontal overflow.

**Accessibility** (`a11y.spec.ts`) — every reachable control has an accessible
name on the public pages and the homeowner forms; a protected page signed out
still has a top-level heading; the skip link reaches `main`; an error summary
takes focus and its entries move focus to the field they name; an invalid field
carries `aria-invalid` and a wired `aria-describedby`; a dialog takes focus and
returns it on Escape; mobile navigation targets are at least 44px.

A defect was found writing these and fixed in the same commit: `SignInPrompt`
rendered an `h2` and was the whole page on a protected route, so those pages had
no `h1` at all — leaving the shell's route-change focus with nothing to land on.

## 3. Not covered, and why

**No automated rule sweep (axe or equivalent).** Not installed, and not added
here rather than pulling a dependency at the end of a branch. The behavioural
checks above cover focus, naming and announcement; they do **not** cover colour
contrast, which has been verified only by design tokens and not measured.

**One browser engine.** Chromium only. No WebKit or Firefox run, so nothing
here says anything about Safari, which matters for a product people will open on
an iPhone.

**No visual snapshots.** Deliberate: a snapshot suite added at the end of a
branch that rewrote every page would encode the current rendering as correct
without anyone having looked at it. Screenshots belong with a human review pass.

**Live Stripe is not exercised.** `stripe.live.spec.ts` is opt-in via
`STEAD_E2E_SUITE=stripe` and a real test-mode key, and it **has not been run on
this branch**. Every payment assertion here is against the mock. The
test-mode gate in the build plan is therefore **not passed**, and PAY-02 —
which is what would make it meaningful — is held.

**Two migrations are unapplied.** `0013_arbiter_claim_visibility.sql` and
`0014_conversion_facts.sql` are applied to local and CI databases, which build
from scratch, and **not to Neon**. Anything they fix is still broken on the
deployed app until an operator applies them. In particular an arbiter still
cannot open a claim there.

**Repeat runs need a fresh database.** The DB-backed suite assumes one. A
second run against the same database fails roughly three tests on leftover
fixture rows (`escrow_audit` actor counts). CI provisions a fresh service each
run; locally, recreate the database between runs.

## 4. Manual matrix — not performed

None of the following has been done. Each needs a person, and none of it should
be reported as covered by the automated suite.

| Area | What a person needs to check | Status |
| --- | --- | --- |
| Screen reader | The booking calendar, the claim confirmations and the error summaries with VoiceOver and NVDA. | Not done |
| Real devices | iOS Safari and Android Chrome at phone and tablet width. | Not done |
| Colour contrast | Measured contrast for every token pair actually used, including the brass on paper and the danger states. | Not done |
| Email | A real magic link, on a device other than the one that requested it, and the cross-device draft message that follows. | Not done |
| Stripe test mode | Checkout, SetupIntent, a declined card, a 3DS challenge, and a webhook arriving late. | Not done (PAY-02 held) |
| Photo upload | A real S3-compatible bucket, including a failed upload and an oversized file. | Not done |
| Connect onboarding | A real Express account through to charges and payouts enabled, and the restricted states in between. | Not done |
| Reduced motion | Every transition with `prefers-reduced-motion`. | Not done |

## 5. Known runtime unknowns

Unchanged from `BASE-01-baseline.md` §7 and still unverified from source:
deployed configuration on Vercel and Neon, cron scheduling for
`expire-pending`, webhook secrets, `PASSPORT_SIGNING_KEY`, and Postmark domain
verification for `openstead.app`.
