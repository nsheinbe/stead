# Stead — complete UI/UX redesign handoff

Prepared September 10, 2026 for implementation by Grok or another coding agent.

**Start with `START-HERE-GROK.md`.** It contains the implementation prompt, reading order, scope, and completion contract. This is a design and build handoff, not a production implementation or a deployed site.

## Open the design

Open **`prototype/index.html`** in a browser. It works offline after extracting the whole ZIP. Use the preview toolbar to select a screen, inspect mobile composition, and view loading, empty, and error states. All people, properties, amounts, messages, and transactions in the prototype are illustrative. Buttons simulate the proposed experience; no email is sent, no account is created, and no payment is taken. The prototype is a visual reference, not code to paste over the existing app.

## Package map

| File | Purpose |
| --- | --- |
| `START-HERE-GROK.md` | Ready-to-use coding-agent prompt |
| `brief/01-PRODUCT-DIRECTION.md` | Strategy, scope, priority, first-principles decisions |
| `design/01-DESIGN-SYSTEM.md` | Tokens, typography, layout, components, responsive behavior |
| `design/tokens.json` | Machine-readable design tokens |
| `design/tokens.css` | Framework-neutral reference variables |
| `design/02-SCREEN-SPECS.md` | Complete route-by-route screen contract |
| `design/03-JOURNEYS-AND-COPY.md` | Renter/homeowner journeys, messaging and recovery copy |
| `design/04-PROTOTYPE-MAP.md` | Preview-to-route mapping, walkthroughs and simulation limits |
| `engineering/01-BUILD-PLAN.md` | Ordered implementation work, dependencies and file mapping |
| `engineering/02-ACCEPTANCE-AND-QA.md` | Acceptance tests, accessibility, security and release gates |
| `engineering/03-MEASUREMENT.md` | Funnel definitions, event contracts and evaluation |
| `reference/BASELINE.md` | Repository version, source findings and precedence |
| `reference/SOURCE-SNAPSHOT.zip` | Clean source snapshot of the exact baseline, including license |
| `reference/ASSET-PROVENANCE.md` | Image origin and permitted prototype usage |
| `prototype/` | Standalone interactive design reference |
| `VALIDATION.md` | What was checked and what remains for implementation |
| `MANIFEST.sha256` | Checksums for all delivered files except the manifest itself |

## Ground rules

- Baseline: `https://github.com/nsheinbe/stead`, commit `f63f1fc68e00d1499eefd022f51a83b1da9b3153` (remote `main` verified at preparation).
- Preserve React, Vite, TypeScript, Tailwind, React Router, TanStack Query, Hono, Neon/Drizzle, Auth.js and Stripe. A new frontend framework or backend rewrite is outside this handoff.
- Redesign the entire existing UI, while shipping in manageable phases. The homepage and signup fixes go first; the rest of the product is specified, not abandoned.
- Existing business/security constraints remain: 30-night minimum, integer cents, server-authoritative quotes, three database roles and RLS, existing payment and claim transitions.
- Reconcile copy with implemented behavior. Do not publish invented testimonials, ownership guarantees, escrow claims, instant payout promises, or prototype inventory.
- No production credentials, private environment files, databases, or dependency folders are included.

If the working repository has changed, read its current instructions, compare against this baseline, and reconcile before editing. Preserve later fixes. Human-readable specifications and live server contracts take precedence over simplified prototype behavior.
