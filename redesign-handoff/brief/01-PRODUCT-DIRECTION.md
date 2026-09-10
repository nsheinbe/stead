# Product direction

## The decision

Redesign the whole product around two tasks: finding a suitable home for 30 nights or more, and making a homeowner's property ready to accept bookings. Use signup as an intermediate measure; value arrives when a renter completes a real booking and a homeowner has a complete, bookable listing.

The requested influences are translated into operational choices, not celebrity endorsement or imitation. First-principles thinking means question the purpose of every requirement, remove unnecessary steps, simplify the remainder, then optimize. The Jony Ive-inspired aesthetic means careful proportion, material honesty, clarity, consistency and quiet confidence. It does not mean hiding controls, tiny gray type, expensive animation or sterile imagery. This is Stead's design language.

## User needs and design consequences

| Need | UI decision | Success evidence |
| --- | --- | --- |
| Renter: is there a suitable home in my city? | City-led discovery, existing filters, real inventory; no signup wall | Search to listing view and authenticated inquiry |
| Renter: what will I pay for my dates? | Minimum duration up front; stay total, network fee and deposit treatment separated | Checkout progression without fee confusion |
| Renter: can I trust this arrangement? | Property-specific facts, real host identity/reviews, policy visible before payment | Booking completion and low cancellation/support friction |
| Homeowner: what happens if I start? | Explain draft → photos/details → payout setup → readiness | Verified signup to complete draft |
| Homeowner: can I finish later? | Draft save and resume with a short checklist | Return-to-draft completion |
| Both: why sign in now? | Contextual email prompt and return to the intended task | Verified sign-in completion without context loss |

## Scope boundaries

All existing pages receive the new system and UX treatment. New `/for-homeowners` and `/host/start` routes organize existing acquisition and listing capabilities. No new marketplace model, short stays, financing, subscription, loyalty system, saved-search alerts, calendar synchronization, map search, wishlist, or host revenue dashboard is required. Those need distinct product/data decisions. Do not claim availability-filtered search where the API only provides catalog filtering.

Avoid locking a user into “renter” or “homeowner” at account creation. Present two clear entry paths and let the same member switch context. Global navigation must preserve access to both.

## Information hierarchy

1. Public homepage: “A home for what's next.” Explain 30+ nights and fee basis immediately, with city discovery and a visible homeowner entry.
2. Discovery: useful homes and meaningful filter controls; price basis clearly “for 30 nights” for comparison, actual dates quoted at booking.
3. Property: imagery and facts, then exact-date price and policies, then real reputation. Trust is contextual evidence, not a carousel of unverifiable badges.
4. Authentication: one email field with “Create an account or sign in”; explain the next action. Technical provider details stay out of customer copy.
5. Homeowner start: simple sequence, saved progress, supported inputs, explicit readiness. Country/time zone are understandable property settings rather than raw codes.
6. Account tools: task-specific working surfaces. Booking status, next action and relevant dates take precedence over decorative cards.

## Copy and claims decisions

Retire the toll-booth metaphor, nine equal-weight marketing sections, decorative stamps/waves and unsubstantiated testimonials. Keep the low-fee proposition, minimum stay and transparent policy. “2% network fee” must use live config in the product; do not promise a permanent rate. Do not promise processing costs are included or host net proceeds equal gross rate without policy validation. Do not add tax/processing line items unless returned by the server.

The baseline's deposit, instant payout, governance and permanent reputation copy requires reconciliation with actual payment operations and organizational facts. A local state named `held` is not proof of regulated escrow. Use deposit-method-specific explanation, factual payout status and “your profile and reviews” until claims are substantiated. No legal or banking guarantees are supplied by this design package.

## Delivery priority

P0: truthful product/payment copy, measurement definitions, shared tokens/navigation, signup continuation and booking draft preservation. P1: public acquisition/discovery and guided homeowner creation. P2: checkout, stays, messages and trust views. P3: payouts, disputes, reviews and operations; full responsive/accessibility verification. These priorities determine build order, not exclusions from the full redesign.

Do not promise uplift percentages before a baseline exists. Evaluate by intent and device. If inventory is sparse, improve real bookable supply in the relevant cities alongside renter acquisition; a high signup count cannot compensate for no suitable homes.

## Research basis and limits

- Repository baseline and code audit are recorded in `reference/BASELINE.md`; no live funnel or production configuration was inspected.
- Nielsen Norman Group, [Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): reduce irrelevant content while preserving the information needed to complete tasks. This supports the hierarchy, not a promised conversion result.
- Accessibility acceptance targets are WCAG 2.2 AA; use the [W3C standard](https://www.w3.org/TR/WCAG22/) when implementing and testing.

The prototype is illustrative visual direction. Screen specifications, server contracts and acceptance criteria define the implementation.
