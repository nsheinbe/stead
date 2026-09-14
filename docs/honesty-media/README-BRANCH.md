# Honesty media handoff (this GitHub branch)

Open **Claude Code on this branch** — the one that already has
`docs/honesty-media/` and `design/honesty-media/`. Do not recreate the
plan on `main`. Do not start from an empty worktree.

## Load order

1. [`START-HERE-CLAUDE-CODE.md`](START-HERE-CLAUDE-CODE.md) — paste-ready
   prompt (fill designs, then build HM-00…HM-09).
2. Repo invariants: `CLAUDE.md`, `BUILD_PROMPT.md` (stack + 30-night /
   host-MOR amendments), `README.md`.
3. Soft Dist gates: [`docs/soft-launch.md`](../soft-launch.md).
4. Engineering tickets: [`BUILD-PLAN.md`](BUILD-PLAN.md).
5. Design to flesh out:
   [`design/honesty-media/DESIGN_BRIEF.md`](../../design/honesty-media/DESIGN_BRIEF.md)
   and
   [`design/honesty-media/SCREEN-INVENTORY.md`](../../design/honesty-media/SCREEN-INVENTORY.md).

## What this branch is

Docs + design handoff only. It does **not** implement capture, workers,
or viewers. It does **not** change `ALLOW_GUEST_BOOKINGS`.

Implementation belongs on a later branch and PR, unless Nick says to
continue here after the designs are filled.

## Do not

- Edit `/design/Stead.dc.html`, `/design/DESIGN_HANDOFF.md`, or other
  immutable design-truth files. Honesty-media design is
  `design/honesty-media/` only.
- Flip guest bookings, seed Production, or run owner migrations on Neon
  without Nick.
- Assign Visual Rails work unless Nick asks.

Copyright 2026 Stead contributors.
