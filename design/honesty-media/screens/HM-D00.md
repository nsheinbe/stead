# HM-D00 — Honesty policy surfaces (HM-00)

**Ticket:** HM-00 · **Route:** none (a copy system) · **Surface today:**
none. **Status:** specified.

## 1. Purpose and primary action

Commit the locked strings and the honesty rules to the app before any
capture code exists, so every later screen imports copy rather than
writing it. There is no CTA; the deliverable is a module and three
one-line mentions on existing pages.

## 2. Who

Everyone reads these strings. Only HM-00 writes them.

## 3. What HM-00 ships

| Item | Where | Content |
|---|---|---|
| Locked strings | `src/lib/honestyCopy.ts` (browser) and a server mirror or re-export the server can import without React | Every key in [journeys §1](../JOURNEYS-AND-COPY.md#1-locked-strings-hm-00): badge, guest disclosure, captured-on and coverage, nearby, host pre-capture sheet, scan state labels, location readouts, refusal messages, allowed and banned verbs |
| Policy version | `HONESTY_POLICY_VERSION = 1` in the copy module (HM-00 adds no migration, per BUILD-PLAN's HM-00 file map); HM-02's migration adds the `app_config` key and snapshots it onto each scan | A later copy change is visible as a version, not a silent rewrite |
| Ban list as a test | `tests/honesty-copy.test.ts` | Asserts no banned verb (journeys §1.9) appears in the copy module, that `BOOKINGS_CLOSED_COPY` and `GUEST_BOOKINGS_CLOSED_MESSAGE` are unchanged, and that the scan refusal does not match the kill-switch regexes |
| Engineering checklist | `docs/honesty-media/POLICY.md` (short) | BUILD-PLAN §4 restated as a reviewer checklist a PR can quote: "stitch / stabilise / compress / cleanup only", no generative step, no beautify control, provenance is a signal |

## 4. Layout

Not a screen. The three one-line mentions below are inline text in
existing components; no new panels, no badges on marketing pages.

## 5. Copy

All strings are in [journeys §1](../JOURNEYS-AND-COPY.md#1-locked-strings-hm-00).
The one-line mentions HM-00 adds to existing pages:

| Page | Where | Exact line |
|---|---|---|
| `/for-homeowners` | `STEPS[1]` "Get ready for bookings" body | "Review your price and policy, set up payouts with Stripe, and walk-scan your home so guests can see the real place." |
| `/for-homeowners` | New FAQ item after "When can a renter pay for a stay?" | **Q:** "What is the honesty scan?" **A:** "Before a home can take bookings, you film a walk through it on your phone. Your phone's location is checked against the home's location while you walk, and the footage becomes a 3D walkthrough guests can explore. We stitch and stabilise it — we never invent rooms." |
| `/host/start` | "What setup covers" list on the signed-out card, after the five wizard steps | "Then: a walk-scan of the home, before guests can book." |

These lines are the only edits to those pages in this phase. They do
not change the wizard steps (`LISTING_WIZARD_STEPS`), the FAQ order, or
any existing test selector.

## 6. Server-authoritative facts

None on this screen. HM-00 defines the vocabulary the server will use
for verdicts; it does not compute any.

## 7. Accessibility

The FAQ item follows the page's existing disclosure pattern. No new
interactive element.

## 8. Hard stops

- Do not ship a capture client (HM-D01) before this module exists.
- Do not add a beautify / enhance / complete-room control anywhere, even
  hidden, even disabled, even behind a flag.
- Do not add a badge to `/for-homeowners`, the landing page, or Explore
  marketing copy: the badge is a per-listing fact, not a marketing mark.
- Do not touch `ALLOW_GUEST_BOOKINGS`, its copy, or its tests.

## 9. Tests

`tests/honesty-copy.test.ts` as in §3. The FAQ addition is covered by
the existing `for-homeowners explains the path` Playwright test only if
that test is extended to assert the new question is present; do that in
HM-00.

Copyright 2026 Stead contributors.
