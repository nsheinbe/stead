# Honesty media handoff (this GitHub branch)

Open **Claude Code on this branch** — the one that already has
`docs/honesty-media/` and `design/honesty-media/`. Do not recreate the
plan on `main`. Do not start from an empty worktree.

## Design status

The design fill is **done and awaiting review** on
`codex/claude-code-handoff-2026-09-14`:
[`design/honesty-media/SCREEN-INVENTORY.md`](../../design/honesty-media/SCREEN-INVENTORY.md)
(every HM-D row specified under `screens/`),
[`JOURNEYS-AND-COPY.md`](../../design/honesty-media/JOURNEYS-AND-COPY.md)
(locked strings and journeys) and
[`DECISIONS.md`](../../design/honesty-media/DECISIONS.md) (reconciled
findings, open decisions, contract deltas). Implementation has **not**
started. The return handoff is in [`CLAUDE-HANDOFF.md`](../../CLAUDE-HANDOFF.md).

## Load order

1. [`START-HERE-CLAUDE-CODE.md`](START-HERE-CLAUDE-CODE.md) — paste-ready
   prompt (fill designs, then build HM-00…HM-09).
2. Repo invariants: `CLAUDE.md`, `BUILD_PROMPT.md` (stack + 30-night /
   host-MOR amendments), `README.md`.
3. Soft Dist gates: [`docs/soft-launch.md`](../soft-launch.md).
4. Engineering tickets: [`BUILD-PLAN.md`](BUILD-PLAN.md).
5. Filled design:
   [`design/honesty-media/DESIGN_BRIEF.md`](../../design/honesty-media/DESIGN_BRIEF.md),
   [`SCREEN-INVENTORY.md`](../../design/honesty-media/SCREEN-INVENTORY.md),
   [`JOURNEYS-AND-COPY.md`](../../design/honesty-media/JOURNEYS-AND-COPY.md),
   [`DECISIONS.md`](../../design/honesty-media/DECISIONS.md).

## What this branch is

Docs + design handoff only. It does **not** implement capture, workers,
or viewers. It does **not** change `ALLOW_GUEST_BOOKINGS`.

Implementation belongs on a later branch and PR, unless Nick says to
continue here after the designs are reviewed. Decisions D01–D21 in
`DECISIONS.md` each carry a recommendation so HM-00 is not blocked; Nick
can overrule any of them before or during implementation.

## Do not

- Edit `/design/Stead.dc.html`, `/design/DESIGN_HANDOFF.md`, or other
  immutable design-truth files. Honesty-media design is
  `design/honesty-media/` only.
- Flip guest bookings, seed Production, or run owner migrations on Neon
  without Nick.
- Assign Visual Rails work unless Nick asks.

Copyright 2026 Stead contributors.
