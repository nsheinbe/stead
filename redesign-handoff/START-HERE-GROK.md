# Paste this prompt into Grok, with this ZIP attached

You are implementing the complete Stead UI/UX redesign described in this handoff. Deliver working changes in the existing application, not a standalone replacement landing page. Carry the implementation through all phases, with runnable checkpoints and evidence for each. Do not stop after a plan or a cosmetic homepage update.

## Inputs and reading order

1. Extract the ZIP. Read this file and `README.md`.
2. Read `reference/BASELINE.md`, then the repository's current instructions, `CLAUDE.md`, `BUILD_PROMPT.md`, `src/App.tsx`, `src/lib/types.ts`, and relevant server routes.
3. Read `brief/01-PRODUCT-DIRECTION.md` and `design/01-DESIGN-SYSTEM.md`.
4. Open `prototype/index.html` for visual direction and simulated interactions. If your environment cannot open it, read its HTML/CSS/JS and use the written screen specifications. Do not pretend you performed visual QA.
5. Read `design/02-SCREEN-SPECS.md` and `design/03-JOURNEYS-AND-COPY.md` in full.
6. Execute `engineering/01-BUILD-PLAN.md`; use the acceptance and measurement documents alongside each phase.

## Locate and protect the source

Use the existing checkout of `https://github.com/nsheinbe/stead` when available. Otherwise clone it, or extract `reference/SOURCE-SNAPSHOT.zip` into a new working directory. The included source is pinned to `f63f1fc68e00d1499eefd022f51a83b1da9b3153`; a source ZIP has no Git history. Compare current main to that commit and preserve later work. Work on a dedicated branch and leave unrelated user changes untouched. Never overwrite a checkout with the snapshot.

The owner explicitly authorized a **full UI/UX redesign and build plan**. This package supersedes the old visual tokens, nine-section landing layout and design-copy requirements where they conflict with the redesign. It does not authorize editing the immutable `/design` references or weakening security/payment rules. Treat this as one authorized redesign initiative delivered in staged checkpoints; do not repeatedly ask whether to begin each already specified local implementation phase. If an unresolved product fact affects money, identity or published claims, implement a truthful neutral state and document the exact remaining decision.

## What to build

- A complete responsive redesign of every current route, including renter and homeowner acquisition, discovery, listing detail, email authentication, three-stage booking, trips, messaging, reviews, Trust Passport, homeowner listings/editing, payouts, claims and operations.
- Add the specified homeowner marketing and guided setup routes using the existing architecture. Keep old routes/deep links working.
- Use the new shared design system: clear sans typography, white and cool-gray surfaces, evergreen actions, authentic property imagery, generous but purposeful spacing, restrained borders and motion. Preserve the Stead name and recognizable mark.
- Fix homeowner auth return destinations, renter checkout draft loss, ambiguous new-member sign-in copy, expired-link recovery, consumer-facing developer copy, and incorrect or unsupported payment/deposit messaging.
- Make listing onboarding resumable without discarding existing data. Add only the explicitly required API/DTO extensions; distinguish new contract work from styling.
- Preserve browsing before authentication. One member may rent and host; entry intent is context, not a permanent account role.
- Implement the measurement contract with verified signup and activation signals; do not count an email submission as a completed signup or a payment-button click as a confirmed booking.

## Constraints

Preserve the existing package manager, lockfile, scripts and stack. Do not add Supabase, replace authentication, build payment fields outside Stripe, invent a host reservation API, or change the 30-night minimum. Keep money in integer cents, quote/state authority server-side, RLS and three database roles intact, and migrations append-only. Use the existing APIs and supported DTO fields, extending owner-only reads where the plan explicitly requires it. Never submit card data, private messages, email addresses, addresses or identity evidence into analytics.

The prototype contains fictional listings and simulated state. Replace examples with live data and realistic empty/loading/error states in production. The generated home image is a concept asset, not evidence of a bookable property. Do not copy fictional reviews, example verification, example booking confirmations or payout readiness into the real app. Do not use photography as a listing unless supplied for that actual property.

Use plain copy about costs, security deposits and payout status derived from authoritative contracts. Avoid claims such as “flat forever,” guaranteed instant bank arrival, “no one can touch it,” permanent undeletable reputation, or member governance unless the operator supplies substantiation. Any unresolved processor or fee-policy facts are launch gates for the affected wording, not reasons to fabricate behavior.

## Execution and evidence

1. Make a concise implementation checklist keyed to the build-plan task IDs, note repository drift, and identify exact files for the first phase.
2. Implement one coherent phase at a time. Preserve a runnable product, logical commits and clear migration boundaries.
3. Run typecheck, required existing tests and build. Report DB/Stripe-dependent skips explicitly. Add regression tests for the documented auth/draft/payment bugs and meaningful new behavior; avoid snapshot tests that only repeat markup.
4. Before calling the redesign complete, test desktop and mobile layouts, keyboard navigation, text zoom, contrast and all key renter/homeowner journeys in a browser. Show the tested viewports and outcomes. If browser or external integrations are unavailable, report that gap rather than claiming a pass.
5. Follow the measurement acceptance rules, verify no PII enters events, and preserve operational webhook idempotency.
6. Produce a reviewable branch or patch plus changed-file summary, test results, screenshots when supported, outstanding runtime setup, and rollback notes. Prepare a draft PR if repository access and the user's workflow support it. Do not merge or deploy production from this handoff alone.

## Completion contract

Every existing route is accounted for and uses the shared system; both acquisition paths work; selected renter context survives email authentication; homeowners can create, resume and publish without losing fields; payment/deposit and claim UI reflect server truth; loading/empty/error/success states are useful; existing permissions and money tests pass; no prototype fixture is presented as a real customer/property/transaction; the application builds; and the specified browser/measurement checks have evidence or are explicitly marked blocked by named external dependencies.

Begin with the baseline comparison and phase 0, then proceed through the full plan.
