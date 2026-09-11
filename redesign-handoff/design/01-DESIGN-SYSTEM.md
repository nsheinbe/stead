# Stead design system — version 1

## Visual thesis

**A precise, welcoming interface for a consequential housing decision.** Bright white surfaces, calm near-black typography, evergreen actions and natural property photography. The interface should feel thoughtfully made and easy to trust. Warmth comes from homes and people, not decorative textures or repeated marketing badges.

Retain Stead's name and existing house/key mark. Simplify the mark to monochrome evergreen/white. Remove decorative gold stamps and waves. Replace the serif display treatment with the existing Hanken Grotesk sans family for both display and controls; use disciplined scale instead of switching typefaces to create hierarchy. The offline prototype uses system fallbacks if Hanken is unavailable; the production build should self-host the licensed existing font or retain the repository's supported loading strategy, with `font-display: swap` and reliable fallback.

The package's `tokens.json` is machine-readable; `tokens.css` shows reference variable names. Implement these through the current Tailwind theme/shared CSS without replacing the stack. Old token names can map to new semantic values during migration to keep routes working. Remove ad hoc styles as each screen is migrated, not through an unrelated mass refactor.

## Color roles

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#FFFFFF` | Main background, form fields, cards |
| Surface | `#F5F7F6` | Secondary panels and grouped content |
| Accent surface | `#E9F1EC` | Selected state and quiet success information |
| Ink | `#17201B` | Headlines, body and key facts |
| Secondary ink | `#53625A` | Explanations and metadata |
| Brand | `#1E4034` | Primary action, selected navigation, meaningful emphasis |
| Brand hover | `#16332A` | Hover/pressed primary actions |
| Subtle divider | `#DCE2DE` | Nonessential grouping boundaries |
| Control border | `#88968F` | Visible field boundaries and secondary buttons |
| Focus | `#276A52` | 3px outer ring, 4px offset; double-ring treatment where required on dark surfaces |
| Danger | `#A73528` / `#FAEBE8` surface | Destructive confirmation and failed/claim-related states |
| Warning | `#78520B` / `#FFF1DD` surface | Action needed, pending restrictions, deadlines |

No communication relies on color alone. Every status has a label and every icon-only action has an accessible name. Subtle divider color is not sufficient for required input boundaries; use the stronger control border. Verify actual rendered pairings against the AA target, including hover, placeholder and disabled-but-informative text. Token-level contrast checks are not a full accessibility audit.

## Typography and content density

| Role | Desktop | Mobile | Line height / use |
| --- | --- | --- | --- |
| Marketing hero | 72–100px, 600 | 48–56px, 600 | 1.02–1.08; max 2–3 short lines |
| Page title | 40–64px, 600 | 32–40px, 600 | 1.10; task title first |
| Section title | 28–40px, 600 | 24–32px, 600 | 1.15 |
| Card title | 20–24px, 600 | 20px, 600 | 1.25 |
| Main body | 16–18px, 400 | 16px, 400 | 1.5–1.65 |
| Label/button | 14–16px, 600 | 14–16px, 600 | 1.35–1.5 |
| Secondary metadata | 12–14px, 400/600 | 12–14px | No essential instructions at tiny sizes |
| Price | 24–36px, 600 | 24–32px, 600 | Tabular numerals; retain currency and basis |

Use `rem` in production. Respect browser font preferences and text zoom. Tight letter spacing belongs only on large short headlines (roughly -0.04em); body is normal. Never overlap glyphs or truncate meaningful amounts/dates. Do not use arbitrary decimal font sizes to reproduce a screenshot. Keep body copy to roughly 55–75 characters per line.

## Spacing, geometry and layout

Use a 4px rhythm with 8, 12, 16, 24, 32, 48, 64 and 96px as primary steps. Controls are at least 48px high by design; a smaller inline action still has a generous effective target. Controls radius 8px, cards 12px, grouped surfaces 16px. Status pills alone are fully rounded. Avoid shadows on every card. Use a subtle shadow for overlays or the occasional elevated summary, not to establish all hierarchy.

Desktop content max 1256px with at least 32–64px outer gutters depending on width. Marketing hero is an intentional 50/50 text/photo split; one large asymmetric photo corner is the memorable visual feature. The photo never contains essential text. Working pages prioritize the controls and record above decorative banners.

Three responsive tiers: under 650px single column; 650–1023px intermediate grids; 1024px and above desktop layouts. Use actual available width, not device detection. On mobile, outer gutters 20–24px, inline form groups stack, property photos remain useful, and summary cards follow the main decision context. Tables either become labeled rows or scroll within their own named container; the entire page never scrolls sideways.

Use a desktop header with visible renter/homeowner entry. In authenticated working surfaces, expose stays/messages/profile and homeowner tools. On mobile, a compact header plus existing-style bottom navigation provides Explore, Stays, Messages, Profile, Homes. Respect safe-area insets and reserve space so bottom navigation or a sticky action cannot cover content or focus. Do not show bottom navigation during a focused authentication, payment or listing-setup flow when it competes with the step action; retain a clear back/exit action and saved-context behavior.

## Component contracts

| Component | Contract |
| --- | --- |
| Button | Explicit verb and object; one primary action per task region. Busy label replaces text while width remains stable; disable duplicate mutations but preserve error recovery. |
| Link | Navigates to a resource or route. Never use a link as a hidden destructive mutation. Use visible underlining for inline text links. |
| Input | Persistent label, native autocomplete/input mode, useful hint, validation close to field. Link error with `aria-describedby`, set `aria-invalid` and move focus to first invalid field on submit. |
| Choice | Native select/radio/checkbox or existing accessible primitive. Do not create decorative toggle chips without selection semantics. |
| Status banner | Title + what happened + useful next action. Use polite live region for asynchronous progress/success, alert for newly surfaced blocking errors. Never expose raw stack/provider errors. |
| Listing card | Actual photo, title, city, type/capacity and explicit price basis. One clear card link; no unsupported wishlist, rating or available-date badge. |
| Price breakdown | Server quote/state, integer cents, effective fee label, deposit method separate from stay charge, currency/date basis explicit. Historical booking snapshots remain authoritative. |
| Trust summary | Distinguish email, phone and government-ID verification. Show earned review counts or honest absence. Never infer trust from illustrative people or images. |
| Form stepper | Named steps and current step; completed step can be revisited without data loss. Announce transition and move focus to heading. Steps are not a substitute for form labels. |
| Save state | Distinguish device-local progress from a saved server draft. Do not show “Saved” until the write succeeds. Keep unsaved input when save fails. |
| Modal/dialog | Use existing accessible primitives or native dialog with labeling, Escape, focus containment, initial focus and focus return. For irreversible actions show actual consequences before final confirmation. |
| Photo uploader | Actual supported file types/limits, upload progress, retry and removal. Use existing attachment API. Accessible reordering requires its own supported backend path; do not fake it. |
| Timeline | Server timestamps and current state, labeled in text. No optimistic financial progress or fabricated deadlines. |
| Empty state | Explain absence in user terms and show one next action. No developer seed commands or imaginary inventory. |
| Table/list | Semantic headers and primary row action. Restrict operational actions according to permissions. Mobile preserves labels and important values. |

Reuse the existing component system. The prototype uses native HTML to remain portable; it does not authorize adding a second UI framework. Extend or replace individual existing components as needed within the current repository conventions.

## Photography and iconography

One generated concept photo is bundled for the offline prototype. It deliberately repeats as the same single fictional property; it is not a gallery of three separate homes. Provenance is in `reference/ASSET-PROVENANCE.md`. Actual listings must use homeowner-supplied or appropriately licensed photos of that exact property. Marketing can use approved non-listing editorial photography, clearly separated from inventory. No fabricated review portraits, trust seals or booking receipts.

Use the existing icon set with consistent 1.5–2px strokes and 20–24px visual size. The source brand mark is retained and recolored. Do not introduce stylized home illustrations or mock UI screenshots as substitutes for real interface controls.

## Interaction and accessibility

Target WCAG 2.2 AA across the complete flow, not only landing pages. Implementation checks include normal text contrast 4.5:1, large text/UI non-text contrast 3:1 where applicable, visible keyboard focus, useful labels, 200% text enlargement, reflow at 320 CSS pixels, reduced motion and non-color status. The 48px control target is a Stead design preference above the standard's minimum target requirements, not a claim that WCAG mandates 48px.

Motion is short (120–180ms) and functional: focus, expansion, saved status. No scroll hijacking, parallax or autoplay. Honor `prefers-reduced-motion`. Authentication must allow paste/autofill and avoid cognitive puzzles. Error recovery preserves entered values and chosen context wherever safe.

See [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for normative criteria, and the package's QA document for the actual test matrix. These are design targets; no production conformance is claimed.

## Prototype versus implementation

`prototype/index.html` visualizes 18 screen views, including the three-stage booking interaction and five-group homeowner setup. It provides responsive composition and example loading/empty/error states. It is intentionally not connected to Auth.js, Stripe, Neon, live uploads or analytics. Full route variations, party-specific permissions and corner cases live in the screen specifications. Those specifications and authoritative contracts take precedence over abbreviated labels or state simulation in the prototype.

Do not copy the preview toolbar, demonstration notices, in-memory fixtures, fixed amounts or simulated actions into production. Preserve the underlying hierarchy, spacing, visual style and behavior contract.
