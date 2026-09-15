# Claude Code handoff — Stead honesty media

Prepared September 14, 2026.

## Checkout

- Repository: `https://github.com/nsheinbe/stead`
- Handoff branch: `codex/claude-code-handoff-2026-09-14`
- Branch base: `1d6cc81adfdd488f8e84ff2106d077dddcb99209`, remote `main` verified when this handoff was prepared.
- Latest merged work: PR #29, honesty-media build plan and Claude Code prompt.

```sh
git fetch origin
git switch codex/claude-code-handoff-2026-09-14
```

Use an existing clean checkout or a separate worktree; preserve unrelated local changes.

## Current state

The original UI/UX redesign has already landed. The old September 10 source snapshot at `f63f1fc` and `redesign-handoff/` are historical references, not a starting point to restore over this branch. Current work is the **honesty-media design handoff**: required property scans with location evidence, faithful reconstruction, and guest indoor/outdoor walkthroughs.

The honesty-media plan is merged. On this branch the design fill is now **done and awaiting review** (see “Return handoff” at the end of this file): every screen-inventory row is specified, `design/honesty-media/JOURNEYS-AND-COPY.md` exists with the locked strings, and `design/honesty-media/DECISIONS.md` records the reconciled findings and every open decision. Capture, reconstruction workers, viewers, and per-listing scan verification are still planned work, not delivered features.

This branch is documentation only. It does not implement the plan or authorize a production change. Older documents refer to “this branch” before PR #29 merged; use the branch and base recorded above for this handoff.

## Prompt for Claude Code

Read this handoff and the files below. Prepare the honesty-media design completion as the first reviewable change. Fill every screen-inventory row with layout, phone/desktop behavior, exact copy, permissions, loading/empty/error states, accessibility, and server-authoritative decisions. Create the host-scan and guest-walk journeys and disclosure copy. Reconcile proposals with the current application and HM ticket dependencies; explicitly record unresolved product or infrastructure decisions.

Keep changes for this first checkpoint in the honesty-media documentation/design scope. The existing honesty-media prompt specifically permits new design work under `design/honesty-media/`; preserve the original immutable design-truth files. Finish the design handoff for review before application implementation. The request that created this branch was to prepare a handoff, so do not treat it as blanket authorization to execute HM-00 through HM-09.

When implementation is subsequently requested, follow the existing Claude Code prompt and build plan, use a dedicated implementation branch from then-current `main` with reviewed design changes included, and deliver one coherent slice per PR. Preserve later fixes. Do not merge or deploy production.

### Read in order

1. [Repository instructions](CLAUDE.md), [build specification](BUILD_PROMPT.md), and [progress](PROGRESS.md).
2. [Soft-launch gates](docs/soft-launch.md).
3. [Claude Code task prompt](docs/honesty-media/START-HERE-CLAUDE-CODE.md) and [branch guide](docs/honesty-media/README-BRANCH.md).
4. [HM-00 through HM-09 build plan](docs/honesty-media/BUILD-PLAN.md), in full.
5. [Design brief](design/honesty-media/DESIGN_BRIEF.md) and [screen inventory](design/honesty-media/SCREEN-INVENTORY.md).
6. Current contracts: `src/App.tsx`, `src/lib/types.ts`, `server/lib/guestBookings.ts`, `server/routes/listings.ts`, `server/lib/storage.ts`, and `drizzle/0001_init.sql`.
7. [Existing QA evidence and gaps](docs/redesign/QA-01-verification.md); historical test results are not results for new work.

### Constraints to carry forward

- Keep `ALLOW_GUEST_BOOKINGS` fail-closed: only exact string `1` enables it. Nick controls the production setting. Required scan verification is an additional planned gate.
- PAY-02 remains held. Do not begin it as part of honesty media.
- Preserve the 30-night minimum, integer cents, server-authoritative pricing/state, Stripe Connect host merchant-of-record, Neon RLS, and three database roles.
- Migrations are append-only. Do not run owner migrations against Neon or seed production from this handoff.
- Preserve `/design/Stead.dc.html`, `/design/DESIGN_HANDOFF.md`, `/design/ios-frame.jsx`, `/design/image-slot.js`, and `/design/support.js`.
- Reconstruct captured reality only: no beautification, generative fill, or invented rooms. Location evidence must reflect its limits; never label it absolute proof.
- Preserve empty production inventory and real-property media provenance. Never publish prototype examples as real listings or verified scans.
- Follow the build plan's licensing constraints; verify current official documentation and licenses before choosing implementation dependencies. Visual Rails is deferred unless requested.

## Verification and return handoff

For design completion, verify all inventory rows are filled, relative links resolve, and specifications map to HM tickets and real contracts. Report unresolved decisions and any browser checks actually performed.

For later code slices, run `npm run typecheck`, `npm test`, and `npm run build`, plus the affected browser journeys. Add meaningful regression coverage, preserve `tests/guest-bookings.test.ts`, and add raw-SQL RLS probes for new tenant tables. Report DB/GPU/WebGL/Stripe and device checks that could not run; never mark skipped gates passed.

Return the branch/commit, changed-file summary, evidence, outstanding decisions or setup, and next ticket. Production configuration and the runtime status recorded in older documents have not been reverified by this handoff.

## Preparation checks

- Started from a clean checkout; fetched current remote `main` and created the named branch at `1d6cc81`.
- Confirmed the existing honesty-media plan, starter prompt, brief, and unfinished inventory are present on that base.
- No application code, schema, dependencies, immutable design references, or synced project sources changed.
- Application tests were not rerun for this documentation-only addition.

## Return handoff — design completion (September 15, 2026)

**Branch:** `codex/claude-code-handoff-2026-09-14`, still based on `main` at `1d6cc81` (nothing new on `main` to merge at the time of writing). Commits on the branch after `9099bd3` are documentation only.

**Changed files (all under the honesty-media documentation/design scope):**

- `design/honesty-media/JOURNEYS-AND-COPY.md` — new. Locked strings (badge, guest and host disclosures, captured-on and coverage, state labels, location readout, refusals, allowed and banned verbs) and the four journeys the brief asked for plus re-mask / revoke.
- `design/honesty-media/DECISIONS.md` — new. Findings re-read at `1d6cc81` (R01–R16), 21 open decisions with a recommendation each (D01–D21), proposed route / DTO / API / table deltas per ticket, and the test map.
- `design/honesty-media/screens/HM-D00.md` … `HM-D13.md` (13 files; D06 and D07 share one) — new. Each: purpose, who, desktop and phone layout, states, exact copy, server-authoritative facts, accessibility, hard stops, tests.
- `design/honesty-media/SCREEN-INVENTORY.md` — rewritten as the index with canonical routes and the rules every screen inherits.
- `design/honesty-media/DESIGN_BRIEF.md` — §2 colour/type reconciled with the shipped redesign, §3 badge lock, §4 journeys pointer, §8 checklist completed.
- `design/honesty-media/README.md`, `docs/honesty-media/README-BRANCH.md`, `PROGRESS.md`, this file — pointers and status.

Not changed: application code, `drizzle/`, seed, `.env.example`, `ALLOW_GUEST_BOOKINGS` semantics, the immutable `/design` files, `CLAUDE.md`.

**Evidence.** Every inventory row has a filled spec; every relative link under `design/honesty-media/` and `docs/honesty-media/` resolves (checked with a script over the markdown); each spec names its HM ticket and the current component or route it maps onto. Typecheck and tests were not rerun for this documentation-only change. **No browser checks were performed** — there is nothing new to run in a browser.

**Findings that change the plan** (details in `DECISIONS.md` §1):

- Coordinates are already writable server-side (`PATCH /api/listings/:id` accepts `lat` / `lng`); what HM-01 must add is the browser contract, the editor control, and a recorded front-door confirmation (R01).
- Publish is a direct column update the host can make under RLS, so the scan gate must live in the database, not only in the route (R02, D04).
- The shipped design system is the 2026-09 redesign: brass and the serif display are retired in code, and `tailwind.config.js` forbids new alias uses. The honesty brief’s colour rules were reconciled to the semantic palette (R08, D01, D02). `CLAUDE.md`’s “Design tokens” paragraph is stale for the same reason and should be updated in a separate change.
- The public listing JSON already returns `addressLine` to any caller, contradicting the editor’s hint that the street address is not public (R15). Pre-existing, outside this scope, queued as a separate task.

**Outstanding decisions for Nick** (each has a recommendation in `DECISIONS.md` §2): honesty colour (D01) and type (D02); worker write path (D03); publish-gate enforcement layer (D04); capture format and upload transport (D05, D06); geofence thresholds (D07); map tiles and geocoder provider (D08); public precision of the pin and approach footage versus the address promise (D09); phone mask approach (D10); revocation semantics (D12); raw-footage retention (D16); neighbourhood-walk and viewer routes (D19, D20).

**Next ticket:** HM-00 (policy copy module, one-line mentions on `/for-homeowners` and `/host/start`, ban-list test) on a dedicated implementation branch off then-current `main`, only when Nick asks. This branch stops at design review.
