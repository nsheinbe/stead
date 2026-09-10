# Baseline, source observations and precedence

- Repository: https://github.com/nsheinbe/stead
- Commit: `f63f1fc68e00d1499eefd022f51a83b1da9b3153`
- Branch at preparation: `main`; remote HEAD checked September 10, 2026.
- Included snapshot: `SOURCE-SNAPSHOT.zip`, a clean archive of tracked files at that commit. No `.git`, installed dependencies, local secrets or runtime database contents are included. The source's Apache-2.0 license is retained.
- This handoff was produced from source review, not from production analytics, browser testing of the existing app, live customer interviews or a verified external payment environment.

## Established source facts

| Area | Evidence | Design/build consequence |
| --- | --- | --- |
| App route inventory | `src/App.tsx` | 18 declared routes plus wildcard redirect; every existing route must remain accounted for |
| Brand/visual baseline | `tailwind.config.js`, `src/index.css`, `src/components/BrandMark.tsx` | Preserve name/recognition, replace visual tokens and typography; immutable `/design` stays reference-only |
| Landing clarity | `src/pages/Landing.tsx` | Nine major marketing sections, 30-night minimum below hero, placeholder Picsum images, hardcoded example passport and reviews |
| Host auth context | `HostListings.tsx`, `Shell.tsx`, `Login.tsx` | Anonymous host banner plus generic login can default to renter trips |
| Booking context | `src/pages/Book.tsx` | Dates/guests/step in component state; login continuation keeps only listing route |
| Auth recovery | `src/pages/Login.tsx`, `server/auth.ts` | Existing email-link stack; errors need safe user-facing mapping and new-member copy |
| Money display | `server/lib/pricing.ts`, `server/routes/bookings.ts`, `src/pages/Book.tsx` | Server excludes deposit from guest total while current payment UI sums it; setup secret returned but unused by browser |
| Host editing | `server/queries/hostListings.ts`, `server/queries/listings.ts`, `src/lib/types.ts` | Required initial create fields; full owner detail can be read through existing listing detail; photo upload needs a saved listing ID |
| Readiness | `HostListings.tsx`, `HostPayouts.tsx`, `server/routes/connect.ts` | Published listing and payment-ready account are distinct |
| Trips | `server/queries/bookings.ts`, `src/pages/Trips.tsx` | Renter trip index exists; do not invent an unsupported host reservations index |
| Permissions | `drizzle/0002_roles_and_rls.sql`, `server/db/client.ts`, `CLAUDE.md` | RLS and separate database roles remain invariants |
| Measurements | Dependencies and source event search | No dedicated signup/conversion instrumentation was found; webhooks are operational signals, not a finished funnel report |

Filenames in this table refer to the source repository (or `stead-source/` after extracting the snapshot), not files in the handoff's `design/` folder. Use GitHub's blob view pinned to the commit for stable attribution, for example:

https://github.com/nsheinbe/stead/blob/f63f1fc68e00d1499eefd022f51a83b1da9b3153/src/pages/Book.tsx

## What is deliberately not assumed

No actual number of members, listings, bookings, conversion rate or conversion uplift is asserted. No production email, Stripe, bank timing, arbitration staffing, ownership structure, image rights or governance implementation was verified. A status variable named `escrow` does not itself establish legal custody arrangements. Replacing unsupported claims with neutral factual copy is part of the design.

## Instruction precedence for Grok

The user requested the full redesign and build plan; the new visual specifications intentionally supersede the old design's exact tokens and landing composition. Existing security, business, money and immutable-reference constraints still apply. Do not edit the original `/design`, application database credentials or synced project `sources/` files. New design assets and notes belong outside that immutable directory.

This package is an instruction and review reference. The clean source snapshot is a baseline, not a request to overwrite the newest repository. Compare first. The source's runtime contract governs actual state and money; specification proposals requiring an extension must be implemented and tested before a corresponding UI promises that behavior.

If documents and the simplified prototype differ, apply this order: security/business invariants and verified server contracts; explicit implementation tickets and screen acceptance; journey/copy rules; design tokens; prototype illustration. Log and reconcile the difference instead of quietly inventing behavior.

## External reference sources

- [Nielsen Norman Group: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/) — supports removing irrelevant information while retaining task-critical information.
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/) — accessibility target and normative criteria. The package does not claim audited production conformance.
- For PAY-02, the implementing agent must use current official Stripe documentation for the installed SDK and account context. This package supplies source findings and constraints, not an unverified ready-made processor sequence.

No direct quotations or celebrity endorsement are supplied. “First principles” and the requested aesthetic are interpreted as design methods in the product direction.
