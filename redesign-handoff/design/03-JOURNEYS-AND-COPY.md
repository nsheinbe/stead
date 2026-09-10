# Stead — journeys, information hierarchy and product copy

**Status:** Proposed design copy and behavior for the full redesign. Grounded in baseline `f63f1fc68e00d1499eefd022f51a83b1da9b3153`; not a statement that features or outcomes are live. Use [screen specs](02-SCREEN-SPECS.md) for data/permissions/state requirements and [build plan](../engineering/01-BUILD-PLAN.md) for implementation order.

## 1. First principles applied to Stead

The core exchanges are simple: a renter needs a suitable home for at least 30 nights; a homeowner needs an understandable way to list, communicate and receive payment; both need honest costs, clear responsibilities and a usable record. The redesign should remove effort around those needs rather than add feature theater.

| Question for each element | Design consequence |
|---|---|
| What decision is the person making now? | One dominant action per view; separate discovery, review and commitment. |
| Is this information required to decide? | Dates, minimum stay, real price, cancellation and deposit terms appear before payment. Architecture diagrams and brand philosophy do not lead the funnel. |
| Can this step be removed or delayed? | Browse without signup; ask for email at messaging/checkout or when saving a home; delay optional listing detail until after draft creation. |
| Is the system making the person repeat work? | Preserve selected home, dates, guests and destination through auth; use saved draft IDs for continued setup. |
| What is the cheapest reliable proof? | Real inventory, exact price rows, actual review records and visible status outperform fabricated reassurance. |
| What would prove the design worked? | Confirmed sessions plus bookings and payment-ready live homes, with failure and abandonment guardrails. |

The visual expression is calm and exact: white space, legible sans typography, crisp edges, real homes and evergreen actions. Inspiration is restraint and care; do not copy Apple's brand, interfaces or imagery.

## 2. Navigation and intent

### Public navigation

**Stead · Find a home · For homeowners · Sign in**

The homepage should serve both audiences but lead with renter search. The homeowner path is equally easy to find in the header and hero. Its dedicated landing page can use its own primary CTA. An optional Rent/Host content control changes visible marketing emphasis; it must never ask a person to permanently pick an account type.

### Signed-in navigation

Renter context: **Find a home · Your stays · Messages · Account**. Hosting context: **Your homes · Payouts · Claims · Messages**, with a visible “Find a home”/workspace switch. Account menu offers own profile/Trust Passport, hosting tools and Sign out. Ops appears only for authorized ops users. Claims reached by a guest should use neutral navigation despite the legacy `/host/claims` URL.

The active workspace is a display preference. An existing homeowner can rent without opening a second account; a renter can start a listing without conversion to a different permanent role.

## 3. Journey A — renter discovery to confirmed stay

| Stage | Person's question | Interface and next action | Continuity/data requirement |
|---|---|---|---|
| Landing | Is this for the length of stay I need? | “Homes for 30 nights or more”; location search; Find a home | Public browsing; only supported filter values |
| Results | Which homes fit my needs and budget? | Real listing cards, location/type/capacity, consistent 30-night estimate | URL stores applied filters; no unsupported availability results |
| Home | Does the home suit me, and who hosts it? | Photos, description/amenities, host/profile, cancellation, price/deposit; Choose dates | Preserve result filters/scroll position on Back |
| Dates | Can I choose my stay length? | Accessible date entry and guest count; Review price | At least 30 nights; listing-local civil dates |
| Price & terms | What am I agreeing to? | Exact nights, estimated stay/network fee, separate deposit arrangement/policy | No commitment yet; store validated non-sensitive selections |
| Authentication | Can I continue without starting over? | “Continue with your email”; send link | Safe callback reconstructs booking target and selections |
| Booking creation | Are the dates and price still valid? | Continue to payment; server rechecks | Show revised price/conflicts; don't create duplicate bookings |
| Payment | What will my card be charged? | Actual charge plus separate supported deposit setup | Use returned quote/intents; handle connected account correctly |
| Confirmation | Is the booking actually confirmed? | Server state, dates, amount and Message host | Confirmed only when authoritative booking state says so |
| Stay | What is the next relevant thing to do? | Message, check terms, review deposit status; review after completion | Role-aware booking record; no invented arrival credentials |

**Optional pre-booking conversation:** Home → Message host → context-specific email sign-in → the exact listing conversation. After sign-in, do not send the renter to their empty trips page. Do not automatically send a message they have not submitted.

**Recovery paths:** Missing inventory → widen filters; home removed → Explore; invalid/short dates → edit in place; host cannot accept payment → explain and offer contact/other homes; declined payment → retry safely; uncertain payment → check status before inviting a second attempt; expired payment window → explain and revalidate through the engineered recovery path. An unconfirmed booking must not be celebrated as a stay.

## 4. Journey B — homeowner interest to bookable home

| Stage | Person's question | Interface and next action | Continuity/data requirement |
|---|---|---|---|
| Homeowner landing | What does hosting here involve? | Longer-stay positioning, short process, factual costs; Start your listing | No fabricated revenue claim |
| Authentication | Can I start without committing the home publicly? | “Start your listing”; email link; “Your home starts as a draft” | Return to guided creation, not `/trips` |
| Basics | What is the minimum information? | Title/type/location/property time zone/capacity | Existing ListingInput only |
| Home details | What should renters know? | Optional description and supported amenities; skip is allowed | No unsupported fields; details can be completed later |
| Price & policy | What do I control? | Nightly rate, deposit and supported cancellation policy; Save draft & add photos | Deliberate values; POST complete required input once with `status: draft` |
| Photos | How do I show the home? | Add photos to the saved draft | Real returned listing ID required before presign/upload/attach |
| Review | Is my home ready to publish? | Review saved fields, photos and readiness | Continue in the existing editor; no duplicate creation |
| Payouts | Can guests pay for a stay? | Continue to Stripe; actual account readiness | Verify both charges/payouts enabled after return |
| Review/publish | What will be public? | Saved home preview and visible readiness checks; Publish listing | Distinguish live status from payment readiness |
| Management | What needs attention? | Real homes, status, Edit/Pause; payout/claim/message tools | No fabricated occupancy/earnings/host-bookings feed |

**Canonical setup order:** Basics → Home details → Price & policy → Photos → Review. Save the first draft at the end of Price & policy, then replace the creation route with `/host/listings/{id}?setup=photos` and continue using the same visual progress. The first saved draft needs only supported required fields; optional Home details can be skipped. Good photos, a useful description, accurate amenities and clear policy improve the eventual listing. Optional details remain editable after the first draft. If the product adopts required photo/description gates, implement explicit shared/server rules rather than adding a misleading client-only “ready” badge.

**Host reservations limitation:** Existing `/api/trips` lists guest stays; no host reservation-list endpoint currently exists. Hosts can access an authorized specific booking from available payout/claim/message context. A complete host reservations index is deferred engineering scope, not a hidden dependency of this visual redesign. Do not populate one with guest trips or fixture bookings.

## 5. Journey C — return, messages, cancellation and claims

**Return:** Email/deep link → session check → exact authorized resource. If the link is unavailable, explain and provide the nearest useful destination. Generic sign-in can default to Your stays; action-specific sign-in never loses its destination.

**Cancellation:** Stay → Cancel → fresh server preview → inspect refund and separate deposit treatment → Confirm cancellation → returned state/summary. Keep/Back remains clear until final action. When timing changes eligibility or amount, refresh the preview. Never claim refund arrival time from the cancellation response alone.

**Claim:** Eligible host opens stay → amount/description → Submit claim → claim detail → attach evidence. Guest follows claim link → reads amount/description/evidence → accepts or records dispute through a confirmation. Authorized arbiter gets outcome form and confirmation; nobody else sees it. Use response flags for allowed actions; record-state change is not proof of money movement. Resolved records remain readable.

**Review:** Completed stay → review page → deliberately choose rating → optional tags/text → Submit review → waiting/published state. Publication follows actual two-sided/time-based policy. The button does not promise immediate publication. Do not default to five stars or market “permanent reviews.”

## 6. Copy system

Write as a capable, calm service. Use familiar words, short sentences and explicit outcomes. “Home” is the listing; “stay” is the booking; “homeowner” is acquisition language; “host” is the person a guest communicates with. “Your stays” means renter bookings. “Your homes” means managed listings. “Network fee” is the configured guest fee. “Deposit” names the arrangement; do not use escrow unless independently established and approved. Use “sign in” for returning users and “create or sign in” explanation for the shared email flow; no duplicate signup/login forms.

### Marketing and navigation copy

| Placement | Proposed finished copy | Rule |
|---|---|---|
| Homepage eyebrow | Homes for 30 nights or more | Visible before search |
| Homepage headline | A home for your next chapter. | Keep concise, imagery supports it |
| Homepage description | Find a place to settle in. Compare homes, understand the price and choose your stay. | Does not imply all inventory furnished or verified |
| Renter primary CTA | Find a home | Opens supported search |
| Hero homeowner link | Have a home to share? List your home | Opens homeowner path |
| Search location label | Where would you like to stay? | Real input, not decorative search bar |
| Search guest label | Guests | Use supported capacity filter |
| Pricing section heading | See how the price adds up. | Arithmetic and clarity, not sweeping savings |
| Guest fee explanation | Stead's guest network fee is {feePercent}% of the stay price. Deposit arrangements, payment processing and any applicable taxes are separate considerations. | Percent from config; do not imply all other charges are in current quote |
| Homeowner headline | A clearer way to host longer stays. | No revenue guarantee |
| Homeowner description | Create your listing, set your rate and help renters find a home for 30 nights or more. | Existing capabilities |
| Homeowner CTA | Start your listing | One canonical guided-flow destination |
| Homeowner supporting line | Your home starts as a draft. You choose when to publish it. | Matches explicit draft creation |
| How it works 1 | Add your home | “Start with the essentials, then add photos and details.” |
| How it works 2 | Get ready for bookings | “Review your price and policy, and set up payouts with Stripe.” |
| How it works 3 | Publish when you're ready | “Check your saved listing before it goes live.” |
| Host account-ready explanation | Payout setup must be complete before guests can pay for a stay. | Readiness verified server-side |

### Search, home and checkout copy

| State/placement | Proposed copy |
|---|---|
| Results heading | Find your next home |
| Results helper | Stays of 30 nights or more |
| Results no match | No homes match these filters. Try another location or adjust your filters. |
| Results no inventory | No homes are listed right now. Check back for new homes. |
| Results retry | We couldn't load homes. Please try again. |
| Missing home photo | Photo unavailable |
| Home estimate | {amount} estimated stay total · 30 nights |
| Home estimate detail | Based on {rate} per night, plus the {feePercent}% guest network fee. Deposit arrangement shown separately. |
| Property primary CTA | Choose dates |
| Property messaging | Message {hostName} |
| Own listing action | Edit your home |
| Owner preview | You're previewing your {draft/paused} listing. It is not publicly available for bookings. |
| Checkout steps | Your stay · Price & terms · Payment |
| Minimum stay helper | Choose at least 30 nights. |
| Selected range | {checkIn}–{checkOut} · {nights} nights · {guests} guests |
| Earliest checkout helper | For this check-in date, checkout is available to select from {minCheckout}. |
| Step 1 CTA | Review price |
| Step 2 CTA | Continue to payment |
| Signed-out step 2 CTA | Sign in to continue |
| Cost row 1 | {nights} nights × {rate} |
| Cost row 2 | Guest network fee ({feePercent}%) |
| Cost row 3 before creation | Estimated stay total |
| Cost row 3 after authoritative quote | Stay charge |
| Deposit neutral heading | Deposit arrangement |
| Price changed | The price has changed. Review the updated amount before continuing. |
| Date conflict | These dates are no longer available. Please choose another stay. |
| Host not ready | This home can't accept payment yet. You can message the host or explore other homes. |
| Pay CTA | Pay {actualCharge} |
| Payment pending | We're checking your payment. Your stay will show as confirmed when payment is verified. |
| Payment failure | Payment wasn't completed. Review the payment details and try again. |
| Payment unavailable | Payment is unavailable right now. Your stay is not confirmed. |
| Payment window expired | The payment window has expired. Your stay is not confirmed. |
| Confirmed | Your stay is confirmed. |
| Confirmed onward | Message {hostName} |

“Checkout is available to select” describes the minimum-length control only; it must not be paired with a green “available” inventory badge. Prefer “Earliest checkout for a 30-night stay: {date}” if ambiguity remains in testing.

**Deposit copy is integration-dependent:** For the current long-stay card-on-file behavior, proposed explanatory copy is “A card is kept on file for the {depositAmount} deposit arrangement. This amount is separate from your stay charge.” Use this only after the setup flow actually confirms the appropriate payment method and approved terms explain possible later charges. Before that point, say “Deposit arrangement: {depositAmount}. Review how it is handled before you pay.” Never state “held,” “charged today,” “returned automatically,” “protected by neutral escrow” or a return date solely from a scheduled database record. If an auth-hold implementation is enabled, write and validate a separate hold-specific variant.

The current price contract does not itemize taxes or processing fees. Do not invent rows or amounts. If a real flow charges additional amounts, extend and validate the quote contract and render them before payment. Copy alone cannot make an incomplete charge total complete.

### Authentication copy

| Placement/state | Proposed copy |
|---|---|
| Generic heading | Welcome to Stead |
| Generic description | Enter your email to create an account or sign in. We'll send you a link. |
| Renter heading | Continue with your email |
| Renter context | We'll bring you back to review this stay. |
| Homeowner heading | Start your listing |
| Homeowner context | Create an account or sign in to save your home as a draft. |
| Input label | Email address |
| Submit | Send sign-in link |
| Busy | Sending your link… |
| Sent heading | Check your email |
| Sent body | We sent a sign-in link to {email}. Open it to continue. |
| Sent support | Check your spam folder if it hasn't arrived. |
| Sent actions | Send another link · Change email |
| Invalid address | Enter a valid email address. |
| Delivery error | We couldn't send the link. Check your email address and try again. |
| Expired callback | This link has expired or is no longer valid. Send a new link to continue. |
| Already authenticated | You're signed in. |
| Context continuation | Continue to your stay / Continue your listing / Open conversation |

Do not show an auth success checkmark merely because the email send request succeeded. An email link may open a new tab; validate continuity there. Do not add a consent checkbox for nonexistent terms or claim acceptance of terms never shown.

### Homeowner, account and service copy

| Placement/state | Proposed copy |
|---|---|
| Homes heading | Your homes |
| First home empty | Start with your first home. Save the essentials now and add photos and details next. |
| Add action | Add a home |
| Draft next action | Continue setup |
| Basics helper | Use the time zone of the home, even if you're somewhere else. |
| Nightly label | Nightly rate (USD) |
| Deposit label | Deposit amount (USD) |
| Guests label | Maximum guests |
| First draft action | Save draft & add photos |
| Draft saved | Draft saved. Add photos now, or come back when you're ready. |
| Unsaved | You have unsaved changes. |
| Save pending | Saving… |
| Save success | Changes saved. |
| Photo empty | Add photos so renters can see the home. |
| Upload error | This photo couldn't be added. Please try again. |
| Publish review | Review your listing |
| Publish action | Publish listing |
| Published | Your listing is live. |
| Live, payout incomplete | Your listing is live, but guests can't pay until payout setup is complete. |
| Pause action | Pause listing |
| Pause confirmation | Pause {homeTitle}? It will no longer appear as available to new renters. Existing bookings remain in place. |
| Delete blocked | This home has bookings. Pause it instead of deleting it. |
| Payout start | Set up payouts |
| Payout handoff | Continue to Stripe |
| Provider helper | Stripe collects the details needed for your payout account. |
| Provider submitted | Your details have been submitted. We'll show your account as ready when Stripe enables charges and payouts. |
| Ready | Ready to accept payments |
| Payout empty | No payouts yet. Payments associated with your stays will appear here. |
| Payout unavailable | We couldn't check your payout account. Please try again. |
| Generic mutation failure | Your changes weren't saved. Please try again. |
| Generic not found | We couldn't find this item. It may no longer be available. |
| Unknown page | We couldn't find that page. |

Do not publish the pause copy if backend behavior changes to leave paused inventory publicly listed. Validate behavior, not just phrasing.

### Stays, messaging, claims and reviews

| Placement/state | Proposed copy |
|---|---|
| Empty stays | Your next stay starts here. Find a home for 30 nights or more. |
| Stay access note | Message your host for arrival details. Times shown use the home's time zone. |
| Deposit section | Deposit status |
| Deposit no data | No deposit update is available yet. |
| Cancel entry | Cancel this stay / Cancel this booking |
| Cancel heading | Review your cancellation |
| Refund label | Refund amount |
| Deposit cancellation label | Deposit release amount |
| Final cancel | Confirm cancellation |
| Cancel alternative | Keep this stay / Keep this booking |
| Canceled success | Your stay has been canceled. |
| Cancel service failure | We couldn't complete the cancellation. Your stay has not been updated. Please try again. |
| Inbox heading | Messages |
| Empty inbox | Your conversations with hosts and guests will appear here. |
| Empty conversation | Ask a question about this home. |
| Composer label | Your message |
| Send | Send message |
| Failed send | Your message wasn't sent. Your text is still here—please try again. |
| Claim empty | You have no claims to review. |
| Claim title | Claim details |
| Claim filing | Submit claim |
| Evidence stage | Claim submitted. You can now add photos and notes. |
| Evidence empty | No evidence has been added yet. |
| Evidence upload | Add evidence |
| Guest response | Review the claim and evidence before you respond. |
| Accept action | Accept claim |
| Accept confirmation | Accept the claim for {amount}? This records your agreement to the claim amount. |
| Dispute action | Dispute claim |
| Dispute confirmation | Record your dispute of this claim? |
| Responded | Your response has been recorded. |
| Arbiter action | Review resolution |
| Arbiter final | Confirm resolution |
| Review renter title | How was your stay? |
| Review host title | How was your guest? |
| Review rating label | Your rating |
| Review tags | What stood out? (optional) |
| Review text | What should others know? (optional) |
| Review submission | Submit review |
| Review pending | Review submitted. It will appear when the publication conditions are met. |
| Review published | Your review is published. |
| Profile no reviews | No published reviews yet. |
| Profile missing rating | Not enough activity yet |
| Owner export | Export your Trust Passport |
| Owner verification | Verify your identity |

Confirmation copy must describe actual consequence, including any applicable money movement, once engineering validates each endpoint. Never understate an irreversible transaction with vague “Continue.” Claims should not imply a guaranteed independent dispute service absent verified operational support.

## 7. Claims language and evidence register

| Do not use by default | Why | Grounded replacement |
|---|---|---|
| “Only 2%” / “2% all-in” | Confuses network fee with total guest cost and other charges | “{feePercent}% guest network fee,” with scope and separate deposit explanation |
| “Hosts keep 100%” | Ignores processing and other applicable costs | Explain the actual displayed payout and processor arrangement |
| “Neutral escrow neither Stead nor host controls” | Database naming is not proof of independent regulated custody | “Deposit arrangement” / “Deposit status” and verified mechanics |
| “Instant payout at check-in” | Payout timing and bank arrival are not established by the page | Actual scheduled/paid/frozen/failed status |
| “Automatically returned” | Depends on method, claims, processor and completed state | Actual release status or method-specific terms |
| “Member-owned” / “You own the network” | No verified ownership arrangement in application contract | “Stead” or “Stead community,” if community context is appropriate |
| “Permanent reviews” | Unsupported broad permanence promise | “Reviews linked to completed stays” when records support it |
| “Every stay/home is verified” | Identity and review records differ from property inspection | State only the exact verified attribute |
| “Request to book” suggesting host approval | Current API has no host approval state/action | “Choose dates” / “Continue to payment”; verify instant-book semantics |
| “Available for your dates” on search | No current availability-search endpoint | Show homes matching supported filters; check chosen dates at booking |
| “Your home is ready” because status is active | Payment setup may still be incomplete | “Live” plus separate payment readiness |
| “Open this link on this device” as mandatory | Can conceal avoidable auth continuity failure | Build safe same/new-tab recovery; state limitations only if real |

Marketing testimonials need a real approved source and provenance before inclusion. Stock or AI imagery must never masquerade as a listed home. Use genuine property photos for inventory; reference/prototype imagery should be labeled as such and replaced appropriately for production.

## 8. Measurement requirements for the journeys

The implementation should use the build plan's canonical event names. The requirements here define meaning, avoiding a second conflicting analytics schema.

| Measurement | Must mean | Must not mean |
|---|---|---|
| Renter/homeowner CTA engagement | Click on identified CTA/entry surface | Permanent user identity |
| Auth started | Valid email sign-in flow requested | Account exists or session confirmed |
| Auth completed | New confirmed authenticated session after flow | Email link successfully sent |
| New account created | Backend-confirmed new account creation, if exposed | Every sign-in; current client session alone cannot distinguish it reliably |
| Draft created | Successful server create with returned listing ID | Opened wizard or typed a title |
| Listing published | Successful server transition to active | Clicked Publish |
| Homeowner activated | Defined combination of real live listing completeness and verified payment readiness | Visual checklist shown or active status alone |
| Checkout started | Defined renter checkout entry | A held/confirmed booking |
| Booking confirmed | Authoritative confirmed booking state, deduplicated | Clicked Pay or frontend redirect |
| Error/abandonment | Explicit mapped failure or defined funnel drop-off | Raw message, email, payment secret or private content |

Report renter and homeowner intent funnels separately while allowing the same user to participate in both. Track secondary quality measures: completed listing quality, readiness failure, booking payment failure, cancellation, no-match search, return-through-auth success and accessibility/task completion in testing. Establish a baseline before asserting uplift. Sample-size or significance thresholds require actual traffic, not invented targets.

## 9. Prototype and build handoff rules

The interactive prototype is a design reference, not a payment or account system. It should label sample data, keep all interactions local, and never collect/send real credentials or payments. Its purpose is to make spacing, hierarchy, audience paths, form clarity and mobile behavior reviewable.

Grok should implement shared shell/components first, then both complete acquisition journeys, then lifecycle/management/ops screens. Copy variants with unresolved processor/legal/operational mechanics remain blocked for production use until the build plan resolves them. Every implemented screen must include empty, loading, failure and success behavior, not just a screenshot-perfect populated state.
