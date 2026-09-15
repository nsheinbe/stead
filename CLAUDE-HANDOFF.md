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

The honesty-media plan is merged, but its screen inventory remains a skeleton. `design/honesty-media/JOURNEYS-AND-COPY.md` does not yet exist. Capture, reconstruction workers, viewers, and per-listing scan verification are planned work, not delivered features.

This branch adds the handoff entry point only. It does not implement the plan or authorize a production change. Older documents refer to “this branch” before PR #29 merged; use the branch and base recorded above for this handoff.

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
