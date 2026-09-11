# Stead — complete screen specifications

**Handoff baseline:** `nsheinbe/stead`, commit `f63f1fc68e00d1499eefd022f51a83b1da9b3153`. This is a proposed redesign and implementation specification, not shipped functionality. All 18 declared route entries and the catch-all in `src/App.tsx` are accounted for below. Read with [design system](01-DESIGN-SYSTEM.md), [journeys and copy](03-JOURNEYS-AND-COPY.md), [build plan](../engineering/01-BUILD-PLAN.md), and [interactive direction](../prototype/index.html). The prototype illustrates selected journeys; this document defines the remaining production screens.

## 1. Product and implementation rules

The design should make a visitor's next useful action obvious: find a suitable home, understand the real price, ask a question, book a stay, or prepare a home for bookings. A new account is an intermediate outcome. Renter activation means a confirmed booking; homeowner activation means a sufficiently complete live listing with payment readiness established. These are hypotheses to measure, not claims of guaranteed conversion uplift.

- **Two journeys, one account.** Renting and hosting are activities, not mutually exclusive identities. Homepage audience choice and current workspace change navigation/context only. The server determines resource permissions.
- **30 nights minimum.** State this above the first search action, on results, on home details, and in date selection. Do not describe a calendar month as exactly 30 nights. Display exact dates and nights.
- **Money must match the server.** Prices are USD integer cents. The guest network fee is currently 200 basis points (2%), read from public config. Do not call it a homeowner fee. Distinguish stay charge, deposit arrangement, processor fees and any applicable taxes. Do not invent tax/processing figures or label a subtotal “all-in.”
- **Payment integrity precedes polish.** Current `CreateBookingResponse` includes `quote`, `depositMethod`, `paymentClientSecret`, and `setupClientSecret`; the existing UI does not fully use them. The server's PaymentIntent currently charges the guest total, excluding the deposit. The redesign must never label stay-plus-deposit as today's card charge without a verified matching processor implementation. Default 30+ night stays produce `card_on_file` with current server configuration. Resolve connected-account setup confirmation and server completion/recovery behavior in the build plan before enabling production checkout.
- **No invented capabilities.** Current public listing filters have no date-availability query and no map coordinates in the browser contract. Availability is checked on booking creation. Do not render a calendar as a verified availability feed, promise host approval, invent earnings forecasts, add favorites, or show fabricated “verified” reviews.
- **Preserve outcomes through authentication.** Carry an allowlisted local destination and validated non-sensitive stay selections through email sign-in. Revalidate after return; authentication is not a reservation. Never persist payment secrets, identity data, private messages, or uploaded evidence in URLs or local storage.
- **Use live facts.** Host name, inventory, review score, payment state, identity status, cancellation amount and claim permissions come from responses. Missing data produces honest missing states, never generated substitutes.
- **One visual language.** White `#FFFFFF`, cool gray `#F5F7F6`, near-black `#17201B`, evergreen `#1E4034`; Hanken/system sans typography, precise whitespace, restrained corner radii, genuine property imagery. Remove decorative gold and ornamental financial graphics. Do not imitate another company's logo or product chrome.

## 2. Global interaction contract

### Shell and responsive structure

Public desktop navigation: Stead → `/`; Find a home → `/explore`; For homeowners → proposed `/for-homeowners`; Sign in → `/login` with context. Signed-in renter navigation adds Your stays, Messages and account menu. Hosting navigation exposes Your homes, Payouts, Claims, Messages and “Find a home.” Ops is only visible to the authorized account flag. Existing URLs remain valid even if labels improve.

Desktop content uses a shared wide container; reading/form screens use a narrower column. Do not keep the present phone-sized application frame on a desktop. At mobile widths, use a compact header and an explicit menu or labeled bottom navigation on browse/account screens. Checkout, auth, editing and messaging are focused flows with a visible Back action. Bottom navigation and sticky actions must never overlap; reserve safe-area space. A keyboard opening must not cover a composer or form action.

### Universal state and accessibility requirements

Every screen specification inherits these requirements; exceptions are noted individually.

| State | Required behavior |
|---|---|
| Initial loading | Skeletons matching content proportions; short labeled loading status. Never display a blank page or false empty state before a request settles. |
| Refresh | Keep valid content visible with a small refresh indication. Disable only actions that would use invalid or unknown state. |
| Empty | Explain what is empty and supply the next relevant action. Do not expose seed commands, environment variables, backend jargon or internal project milestones. |
| Validation error | Retain valid input. Pair field error text with the field, summarize on submit, focus the first invalid field. A disabled button alone does not explain an error. |
| Network/server error | Plain-language explanation and Retry. Preserve drafts. Show generic user-safe text unless a mapped API error is actionable. |
| Unauthorized | Wait for session resolution, then show context-specific sign-in with the exact safe return target. Distinguish no access/not found from service failure without leaking another user's resource details. |
| Mutation pending | One submission at a time; action label describes progress. Do not optimistically confirm payments, publication, cancellation or claim resolution. |
| Success | Use returned server state; announce once in a polite live region and retain a useful onward action. A toast is insufficient for a financial result. |

Use semantic headings, forms, lists/tables, landmarks and a skip link. Label all controls visibly; icons supplement text. Meet WCAG 2.2 AA targets in the build checks: text contrast, visible focus, keyboard operation, 200% zoom, reflow at 320 CSS pixels, reduced motion, and at least 44×44 CSS pixel product touch targets. Do not encode status only by color. Dates include day/month/year and local time zone where material. Modals/sheets manage focus, trap it while open, close with Escape where appropriate and return focus to the trigger. Route changes move focus to the main heading and announce the page title.

## 3. Route inventory

| ID | Existing route / component | Proposed experience | Access / primary action |
|---|---|---|---|
| S01 | `/` — `LandingPage` | Audience-aware landing page | Public / Find a home |
| S02 | `/explore` — `ExplorePage` | Search and comparison grid | Public / Open a home |
| S03 | `/listing/:id` — `ListingDetailPage` | Property, price and suitability | Public active listings; owner preview allowed / Choose dates |
| S04 | `/book/:listingId` — `BookPage` | Three-step stay checkout | Dates/price public; auth before booking mutation / Continue then Pay |
| S05 | `/trips` — `TripsPage` | Renter's stays | Signed in / Open stay |
| S06 | `/trips/:bookingId` — `TripDetailPage` | Shared booking lifecycle, role-aware | Authorized guest/host / State-dependent action |
| S07 | `/messages` — `MessagesPage` | Inbox | Signed in / Open conversation |
| S08 | `/messages/:listingId` — `ListingMessageRedirect` | Guest conversation shortcut | Auth gate retaining listing / Resolve thread |
| S09 | `/messages/:listingId/:guestId` — `MessageThreadPage` | Conversation | Authorized party / Send message |
| S10 | `/review/:bookingId` — `ReviewPage` | Structured review and submission state | Authorized party / Submit review |
| S11 | `/passport/:userId` — `PassportPage` | Profile and substantiated reputation | Public read; owner actions gated / View reviews or verify/export own profile |
| S12 | `/host/listings` — `HostListingsPage` | Your homes and readiness | Signed in / Add home or continue draft |
| S13 | `/host/listings/:listingId` — `HostListingEditPage` | Home editor and publish review | Listing owner / Save changes, then Publish |
| S14 | `/host/payouts` — `HostPayoutsPage` | Payout readiness and ledger | Signed in, own data / Continue to Stripe |
| S15 | `/host/claims` — `HostClaimsPage` | Claims involving this account | Signed in, permitted data / Open claim |
| S16 | `/host/claims/:claimId` — `HostClaimDetailPage` | Evidence and role-aware claim response | Authorized host/guest/arbiter / Contextual response |
| S17 | `/ops` — `OpsPage` | Operational health and exceptions | Server-authorized ops / Refresh or inspect |
| S18 | `/login` — `LoginPage` | Email signup/sign-in and callback recovery | Public / Send sign-in link |
| S19 | `*` — current redirect to `/explore` | Deliberate not-found view | Public / Find a home or go back |
| N01 | **NEW** `/for-homeowners` | Homeowner acquisition page | Public / Start your listing |
| N02 | **OPTIONAL NEW; recommended** `/host/start` | Short guided draft creation | Auth before saving / Save draft |

N02 can instead be a routed flow under `/host/listings?create=1` if minimizing route additions is preferred. Choose one canonical URL in implementation and update all links consistently. The proposed wizard adds no database entity. Cancellation and claim creation remain states within S06; the three checkout steps remain states within S04. Do not count them as existing routes.

## 4. Public discovery

### S01 — Landing `/`

**Purpose:** In one viewport, explain the category and give both audiences a credible next action.

**Desktop layout:** Clear header; two-column hero with a short headline and working location search on the left, authentic home photograph on the right. Put “Homes for 30 nights or more” adjacent to the headline/search. Main CTA “Find a home.” Secondary homeowner link “List your home.” Then real inventory preview (if available), a three-part explanation of search/price/booking, a concise transparent-pricing section, homeowner invitation and compact FAQ/footer. Keep a strong editorial hierarchy; avoid repeated floating cards and feature badges.

**Mobile:** Headline and search first, imagery next. Location and guest fields stack. At least one obvious action remains visible without scrolling; no forced audience interstitial. Homeowner link stays above the fold. Lower sections become simple vertical rows.

**Data and actions:** `api.listings()` for genuine preview cards and locations; `api.config()` for fee explanation. Submit supported search parameters to `/explore`. Do not collect dates in homepage search until date intent/availability distinctions are implemented; the primary baseline searches location and guests only. Audience preference changes content emphasis, never account permissions.

**States:** Loading inventory does not block hero/search. Zero inventory shows “Explore Stead” information and homeowner invitation without fake cards or stock homes posing as inventory. Inventory error offers “Try browsing homes” and Retry. Success is navigation to real results; signup is offered at a meaningful action, not required to browse.

**Accessibility:** Real form and visible labels. Hero photo has descriptive alt text when informative. Decorative photography has empty alt text. Any audience toggle uses accessible button state, not hidden links.

**Acceptance:** Renter and homeowner paths work from 320px through desktop; 30-night minimum is visible before search; no unsupported testimonials, ratings, ownership or “only 2% total cost” promise; keyboard submit preserves guest/location filters; layout does not shift when photos load.

### S02 — Explore `/explore`

**Purpose:** Let renters compare actual homes quickly without signing in.

**Desktop layout:** Page heading “Find your next home”; 30-night helper; working search field; visible city/guest controls and Filters button; result count; responsive three-column property grid, falling to two columns as space narrows. Each card has 4:3 image, city, title, type/capacity and comparable price. No pretend map or “available for your dates” statement.

**Mobile:** One-column cards with compact search. Filters open a focus-managed sheet with Apply and Clear. Active filters appear as removable labeled chips, not unreadable badges. Preserve scrolling position after opening and returning from a listing.

**Data and actions:** `api.listings(filters)` with only `q`, `city`, `type`, `guests`, `maxNightlyRateCents`, `instantBook`; query-string keys `q`, `city`, `type`, `guests`, `maxRate`, `instant` as implemented in `src/lib/filters.ts`. Use URL as source of applied filter state. Only expose instant-book filtering if its business meaning is verified; no host approval workflow currently exists. Optional client sort is permitted only as explicit sorting of the loaded set.

**Price:** Prefer a labeled “30-night estimate” based on nightly rate plus configured network fee, with nightly rate subordinate and deposit separate. Exact selected-stay quote appears later. Config unavailable: show nightly rate and a clear “Fees shown at checkout” label rather than asserting a final total.

**States:** Skeleton grid on first load; keep prior results during filter refresh with busy state. No inventory differs from no matching inventory. Filter empty state offers Clear filters and shows which constraints apply. Error retains filters, offers Retry; no data-seeding instructions. Missing image uses a neutral “Photo unavailable” surface.

**Accessibility:** List/grid markup with one meaningful card link and no nested interactive elements. Descriptive card link names. Announce result count after Apply without stealing focus.

**Acceptance:** Direct URL load and browser Back restore filters; unknown/invalid query values normalize safely; price labels remain consistent across cards/detail/checkout; results remain ungated; no fabricated availability.

### S03 — Home detail `/listing/:id`

**Purpose:** Establish suitability, real price and confidence before checkout.

**Desktop layout:** Breadcrumb back to filtered results; title/location; gallery with main image and smaller supporting images; content and sticky booking summary columns. Content order: type/capacity, description, supported amenities, host/profile link, cancellation policy, deposit explanation. Summary: labeled 30-night estimate until dates chosen, rate calculation, separate network fee, deposit terms, “Choose dates.” Message host is secondary.

**Mobile:** Single swipe/button-controlled gallery with photo count; title and essential facts; reading content; sticky footer with amount label and Choose dates. Hide sticky action while conflicting sheets are open. Price details remain reachable from the footer.

**Data and actions:** `api.listing(id)`, config. Display only amenities present/true, distinguish zero bedrooms from absent data, use human type labels. Do not label bedrooms as beds. Host link → `/passport/:userId`; message → S08; own-listing view shows “Edit your home” instead of self-booking/message actions. Owner preview of draft/paused listing gets a visible preview/status banner and cannot imply publicly bookable inventory.

**States:** Loading with fixed gallery dimensions; no photos state without Picsum fallback; not-found/unavailable state with back-to-results; absent host data suppresses contact link and avoids inventing identity; description/amenities missing state is discreet and honest. Booking server still checks active status, capacity, date conflict and payout readiness later.

**Accessibility:** Keyboard gallery navigation and labeled buttons; no autoplay; informative photo alternatives use existing title/photo sequence because no photo-caption field currently exists. Gallery dialog supports focus and Escape.

**Acceptance:** No exact street/address publication is newly introduced by the redesign; address exposure follows existing approved visibility. Direct links work; own listing cannot be booked; cancellation terms precede the booking commitment; total is explicitly estimated until valid dates and server quote are available.

## 5. Signup and checkout

### S18 — Email authentication `/login`

**Purpose:** Complete a renter or homeowner action with a single email entry and preserve intent.

**Desktop layout:** Small centered form, brand mark/back link, context headline, one email field, clear submit button, explanation that one link creates or opens the account. Beside/below the form, show compact context: selected home and dates for booking, or “Your listing starts as a draft” for homeowners. No unrelated promotional hero.

**Mobile:** Same reading order; appropriate email keyboard, autofill and 16px+ input text. “Change email” remains available in sent state.

**Data and actions:** `useAuth`/`api.me`, `api.sendSignInLink(email, callbackUrl)`, existing Auth.js email provider. No Google/Apple/password controls until integrated. Generic sign-in may default to `/trips`; homeowner flow must explicitly return to N02 or create mode; booking flow must restore validated selections and review step. Safe-return helper must reject foreign origins, protocol-relative targets and recursive login loops. Prefer allowlisted path patterns and reconstructed query values over blindly forwarding `next`.

**States:** Session checking; form; sending; sent with masked or user-entered email and edit/resend action; actionable delivery failure; callback expired/invalid with re-send; already signed-in with “Continue to …” or direct safe continuation. A sent link is not a successful signup, a reserved date, or a held price. Do not show a hold countdown before `createBooking` succeeds.

**Accessibility:** Email label, `autocomplete=email`, validation before submit, polite sent-state announcement, visible focus on the sent heading. Avoid announcing full email addresses unnecessarily in a public context.

**Acceptance:** Test renter selection return through same-tab and new-tab email callback; homeowner returns to draft flow rather than trips; already signed-in users continue immediately; malformed return URL goes to safe fallback; interrupted flow can be resumed without a payment secret in URL/storage. No success analytics before confirmed session.

### S04 — Checkout `/book/:listingId`, shared frame

Three clearly named steps: **1 Your stay → 2 Price & terms → 3 Payment**. Desktop: progress and form left, persistent compact home/stay summary right. Mobile: progress header, one-column content, inline or sticky current action with sufficient bottom spacing. Back edits the prior step without losing selections. Date/guest edits after a server booking has been created must invalidate that booking association and follow the build plan's pending-booking recovery rules; never pay an old intent for new selections.

#### Step 1 — Your stay

**Purpose/action:** Choose valid listing-local dates and guest count; “Review price.”

**Layout:** Two labeled date fields plus accessible calendar, minimum-stay explanation beside selection, guest stepper with explicit limits. Desktop can show adjacent months; mobile one month with navigation and text-entry fallback. Date input is not an availability calendar: absent booked-day data must not be rendered as confirmed available.

**Data:** Listing capacity, listing time zone, public check-in/out local times, `MIN_STAY_NIGHTS`, date helpers. Validate calendar reality, start date, end after start, at least 30 nights and capacity. Show earliest valid checkout when check-in selected. Do not silently change dates to create a valid quote.

**States:** Loading listing disables selections; unavailable listing offers Explore; partial date entry prompts remaining field; invalid range explains correction; capacity change clamps only with visible explanation if persisted count exceeds new maximum. Success moves to step 2 without creating a booking or requiring auth.

**Accessibility/acceptance:** Keyboard/date-text selection, full date labels, announced selected range; 29 nights rejected and 30 accepted; local civil dates remain stable through DST/browser time-zone differences; Back/reload/auth restoration retain valid values.

#### Step 2 — Price & terms

**Purpose/action:** Review the exact requested stay before authentication/booking creation; “Continue to payment,” or “Sign in to continue” when signed out.

**Layout:** Dates/guests with Edit; nightly rate × exact nights; network fee with configured percent; clearly labeled estimated stay total before creation; separate deposit arrangement; listing cancellation policy in plain language. A fees note distinguishes known charges from any taxes/processing not represented in the current quote contract. Do not collect blanket consent to invisible terms or link to nonexistent policy pages.

**Data:** Client quote is an estimate. On continuation, authenticate if needed, then call `api.createBooking` with only listingId/checkIn/checkOut/guests; use returned authoritative quote. If price differs, show the revised amount and require renewed review before exposing the final pay action. Host readiness/date conflicts must map to clear recovery.

**States:** Creating booking disables duplicate action; missing payout readiness offers Message host/Explore without blaming the renter; date conflict returns to selection while retaining the attempted range for editing; rate/config change shows old/new values; error never discards selection. Success creates a pending booking, then step 3.

**Accessibility/acceptance:** Money is semantic rows, no color-only difference; exact nights visible; deposit not silently included in charge; authority switches to returned quote; authentication does not fire duplicate booking mutations.

#### Step 3 — Payment

**Purpose/action:** Authorize the actual stay charge and any supported deposit setup, then show server-confirmed booking state.

**Layout:** Stay summary; returned price; processor-managed payment controls; distinct deposit method explanation; cancellation reference; final amount-labeled action “Pay {actual charge}.” Show payment/deposit setup progress separately when separate processor confirmations are required. Do not present a single completed state until required backend/processor completion criteria are met.

**Data:** `CreateBookingResponse.quote`, payment/setup secrets, deposit method, Stripe configuration, subsequent `api.trip(bookingId)` response and authoritative events. Current server creates a destination PaymentIntent for `guest_total_cents` and a separate connected-account SetupIntent. The client must implement the supported account-scoped setup flow before relying on card-on-file. Specifying that flow is an engineering prerequisite, not a license to simulate it. Hold duration comes from config, not hardcoded 30-minute marketing text; a reliable expiry timestamp/countdown requires validated source data.

**States:** Processor loading; submission pending; additional authentication/redirect; recoverable decline preserving selections; payment status uncertain (check booking status before inviting payment again); expired pending booking; payment submitted/awaiting confirmation; confirmed booking. When payment is unavailable, show “Payment is unavailable right now. Your stay is not confirmed” with a return action. Mock payment is development-only, visibly labeled and excluded from conversion measurements.

**Accessibility/acceptance:** Stripe controls remain keyboard/screen-reader usable; errors focus/announce appropriately. Actual button amount equals processor amount, not guest total plus deposit by assumption. Payment refresh/back/redirect cannot create a duplicate charge; a frontend redirect alone never renders “Confirmed.” Payment data is never logged to analytics. Test connected-account setup and payment failure/recovery in the build plan before release.

## 6. Stays and trust

### S05 — Your stays `/trips`

**Purpose/action:** Find the renter's current, upcoming and past stays; open the relevant stay.

**Desktop:** Heading and Find a home link; groups for Current/upcoming and Past, derived from existing status/dates. Readable rows/cards show photo, title, location, exact dates, nights and state. Avoid invented spend totals or membership dashboards.

**Mobile:** Stacked cards with a generous full-row target. A pending-payment item is clearly distinct from Confirmed. Expired and canceled stays do not dominate current ones.

**Data:** `api.trips()` is guest-only (`listTripsForGuest`). Do not repurpose this as a host reservations list. Status labels: pending_payment “Payment pending”; confirmed “Confirmed”; checked_in “In progress”; completed “Completed”; canceled_by_guest “Canceled”; canceled_by_host “Canceled by host”; expired “Payment window expired.”

**States:** Inherited loading/error/auth; empty “Your next stay starts here” with Find a home. Results refresh after cancellation. Pending items link to stay detail; no invented “Resume payment” action until a safe existing-booking resume path exists.

**Accessibility/acceptance:** Semantic grouping with dates; status in text; long property names wrap; guest-only data remains guest-only; all states route to S06 and remain distinguishable without color.

### S06 — Stay detail `/trips/:bookingId`

**Purpose:** Present the next relevant action and a reliable record throughout booking, cancellation, deposit, claim and review lifecycle. Same URL supports guest and host, driven by `viewerIsHost`.

**Desktop:** Status heading and primary action; home/dates/party summary; primary details column plus cost/deposit/status column. Display check-in/out in listing-local time; “Message {counterpart}” prominent. No invented door code, key handoff, arrival instructions or live support channel. Hosts can see guest context without renter-oriented wording.

**Mobile:** Status and next action first, then dates/access note, messages, price, deposit status, policy and lower-priority actions. Cancellation and claim controls should not be the loudest element for a normal confirmed stay.

**Data:** `api.trip`, config, `cancellationPreview`, `cancelTrip`, claim operations, review state. Preserve every backend status; do not infer payment completion from location or a local state variable. Deposit timeline shows actual audit steps/dates from response and a neutral “No deposit update yet” when absent; name the section “Deposit status,” not neutral escrow.

**Primary actions by state:** pending → check payment status/recovery instructions; confirmed → Message host/guest; checked_in → Message; completed + canReview → Write review; open claim → Review claim; canceled/expired → Find a home for guests or Your homes for hosts. Surface server-authorized actions rather than always rendering every possible lifecycle control.

**Cancellation subflow:** “Cancel stay/booking” opens a focused confirmation view. Fetch a fresh cancellation preview on open. Show exact stay refund, fee retained/refunded, deposit released and total refund separately using returned fields, with policy/time-zone context. Primary final destructive action “Confirm cancellation”; safe alternative “Keep this stay/booking.” The server recalculates eligibility; changed preview/409 returns to refreshed facts. Success is persistent canceled state with returned summary; no promise that a refund has already reached the bank.

**Claim creation subflow:** Only show when server-supported host eligibility exists (currently host + claim-window state, no claim). Display deposit cap and available claim-window timestamp; collect amount and description, validate cents and cap, then submit. On successful creation route/open S16 to add evidence. Do not require pre-creation file uploads to an endpoint that needs a claim ID. Make clear that saving the claim and attaching evidence are separate steps. Upload failure must preserve the created claim.

**States:** Inherited loading/auth/error, unauthorized/not found, delayed post-payment confirmation, pending/expired/canceled statuses, unavailable deposit timeline, claim response success and cancellation failure. Never use internal text such as “Slice 1” or explain tenant-security rules in product UI.

**Accessibility/acceptance:** Timeline as ordered list with text states; confirmation focus management; amounts announced in labeled rows. Cannot cancel through stale client permissions or claim outside allowed window; duplicate clicks suppressed; guest/host copy correct; completed review link follows `review.canReview`; return navigation keeps workspace context.

### S10 — Review `/review/:bookingId`

**Purpose/action:** Submit a fair review for a completed stay; “Submit review” rather than “Publish review.”

**Desktop/mobile:** Narrow reading/form column. Stay/counterparty context; short publication explanation; labeled 1–5 rating radiogroup; optional existing role-specific tags; labeled review textarea; submit action. Use neutral evergreen/ink stars, not decorative gold. Default rating should be unselected, avoiding an implied five-star response. No autosubmit or coercive prompt.

**Data:** `api.reviewForm` determines viewerRole/direction, completion, canSubmit, own submission and published reviews. Use `GUEST_REVIEW_TAGS`/`HOST_REVIEW_TAGS`, existing 4,000-character body limit and server rules. Publication occurs according to backend two-sided/14-day policy; revalidate timing wording against implementation before release. No editing/deleting UI without endpoint support.

**States:** Not yet eligible; editable; submitting; submitted waiting for publication; published; existing-review 409 reloads existing review; unavailable/not found; submission error keeps content. Acknowledgment says “Review submitted” and then accurate publication state. Never promise permanence or immutable ownership.

**Accessibility/acceptance:** Rating uses radiogroup semantics and selected value; tag buttons use pressed state; body label visible; no default-five bias. Submitted and published are distinct; correct role tags; repeated submission doesn't produce duplicate reviews.

### S11 — Profile and Trust Passport `/passport/:userId`

**Purpose:** Show actual experience and reviews with understandable context; owner can verify identity/export existing signed data.

**Desktop:** White page with profile header, actual verification state and compact experience metrics, then published reviews. Use separate labels for ratings as host and as guest. Secondary explainer “About this profile” and owner-only export action. A full dark identity card should not swallow the page.

**Mobile:** Profile summary then metrics in two columns, reviews in vertical order; preserve readable body text. Owner identity action below summary when eligible, not an account-wide blocker for browsing.

**Data:** `api.passport`, `api.startIdentity`, `api.exportPassport`. Stats are displayed exactly: null means “Not enough activity yet,” not zero rating. Receipt/verified-stay indicator only for returned published review records, not marketing placeholders. “Identity verified” only when the backend tier/state supports that exact claim; a badge is not a safety guarantee. Differentiate identity verification from completed-stay history.

**States:** Loading; missing profile; zero reviews; no rating as a particular role; identity opening/pending/already verified/error; export pending/success/failure. Verification availability must be grounded in integration readiness, not merely possession of a publishable key. Provider return refetches actual status.

**Accessibility/acceptance:** Ratings have numeric text and count; descriptive export label; image avatar fallback initials; review body stays plain text. Viewing another user's profile cannot invoke owner-only export/identity operations; no “permanent,” “member-owned,” or universal portability promise.

## 7. Homeowner acquisition and management

### N01 — New homeowner page `/for-homeowners`

**Purpose/action:** Explain how listing works and lead to a draft, with “Start your listing.”

**Desktop:** Dedicated hero with genuine home imagery and concise promise “A clearer way to host longer stays”; secondary “See how it works” anchor. Sequence: draft → add photos/details → set up payouts → review/publish. Explain 30+ night positioning, pricing controls, messaging, cancellation/deposit terms with factual copy. End with useful FAQ and repeated Start action.

**Mobile:** CTA early, short sequence, restrained imagery. No earnings calculator, lead form with unavailable backend, fabricated booking counts or guessed homeowner savings.

**Data:** Public config for guest fee; optional genuine imagery from authorized asset library. Signed-out CTA → login with N02/create return; signed-in → same draft flow. Existing host can choose “Your homes.” Readiness messaging must say a live listing can still need payout setup under current backend behavior.

**States:** Static content does not depend on inventory; fee config failure removes precise numeric assertion rather than blocking page; auth resolution keeps CTA stable. Success is entry into draft flow, then authenticated session measured separately.

**Accessibility/acceptance:** Renter path remains accessible; user is not locked to hosting; no unverified “instant payout,” “zero fees,” guaranteed income or independent escrow claims; every CTA shares canonical destination.

### N02 — Recommended guided creation `/host/start` (or `/host/listings?create=1`)

**Purpose/action:** Create a useful draft with the least necessary input, then guide completion. No promise of “published in 2 minutes.”

**Layout:** Use five groups shared with the existing listing editor: **Basics → Home details → Price & policy → Photos → Review**. Narrow form with named progress and Back; desktop side panel explains draft visibility; mobile progress at top and single action below fields. Basics captures title/type/city/country/property time zone/capacity. Home details collects optional description and supported amenities and can be skipped. Price & policy captures deliberate nightly USD, deposit USD and cancellation policy. At the end of this third group, show a compact summary and **Save draft & add photos**. Only then create the draft and move to Photos with a real listing ID; Review uses saved data for publication. Time zone may suggest device zone but explicitly asks the homeowner to confirm the home's zone; never assume they are physically at the property. No silent default price/deposit that can be published accidentally.

**Data:** Existing `ListingInput`: required title, type, city, country, timezone, nightlyRateCents, depositCents, maxGuests. Explicit `status: draft`. API accepts title 3–140 characters, city 1–140, 2-letter country code, valid IANA time zone, positive integer-cents nightly rate, nonnegative deposit, guests 1–50. Present country names in UI while sending code, and a searchable time-zone selector with readable examples. Stay minimum remains platform-wide; no host-editable minimum-stay field.

**Optional existing fields:** Description, region/address and amenities may be skipped in Home details and completed in S13 after the first draft. Type is available at creation; cancellation policy is selected/reviewed in Price & policy using current supported values. No bathrooms, pet policy, workspace, square footage, external calendars or dynamic monthly discount unless a separate schema/API change is approved.

**Save behavior:** No listing API call until all required input is complete, at the end of Price & policy. Submit once; successful `createListing` returns ID and replaces the creation URL with S13, for example `/host/listings/{id}?setup=photos`, showing “Draft saved” and the Photos group. Keep the same five-group visual progress while continuing through the existing editor. Review is then based on saved data and leads to the explicit publish flow from S13. Use API-persisted draft for subsequent changes; never create again when going Back. Do not begin presigned photo upload while there is no listing ID. If auth expires, retain only a minimal safe recovery mechanism; do not place full address/home description in callback URLs or promise cross-device restoration before server save.

**States:** Empty fields; field validation; saving; server rejection with retained input; expired session; draft created. Reload recovery before first save is optional and must be explicitly implemented; show “Your draft saves when you select Save draft & add photos,” not false autosave text.

**Accessibility/acceptance:** Progress is an ordered list; labels and optional/required markings; no lost data on Back; prices parsed via cents helper; no new permanent user role; create once then edit existing ID, never create duplicate homes on step movement or reload.

### S12 — Your homes `/host/listings`

**Purpose/action:** Continue preparation or manage live/paused homes. Primary “Add a home”; incomplete home “Continue setup.”

**Desktop:** Heading/CTA; compact payout-readiness banner; list/grid of real homes with photo, title/location, status, nightly rate and next action. Optional tabs All/Draft/Live/Paused filter returned data locally. No fabricated occupancy, earnings, guest pipeline or reservation table.

**Mobile:** One home per card; same priority. Primary inline action Edit/Continue; overflow for Pause/Delete. Publishing is deliberate from editor review, not an accidental card toggle.

**Data:** `api.hostListings`, `api.connectStatus`; create via N02; status transitions/update/delete via existing APIs. Readiness checklist is computed from actual supported data, never a new database status. Distinguish `active` (“Live”) from “Ready to accept payment”: a listing may be public while Connect isn't ready under current rules. Do not silently change publish eligibility; any stricter gate must be an explicit product/API change.

**States:** Empty “Start with your first home” plus CTA; draft/live/paused; payout status unknown versus incomplete; mutation errors attached to the correct card. Delete confirmation names the home; 409 displays “This home has bookings. Pause it instead.” Success follows API and invalidates appropriate listing queries.

**Accessibility/acceptance:** Clear text statuses; per-card actions identify listing; confirmation accessible; no destructive default; host does not lose renter navigation; all list data belongs to session account.

### S13 — Home editor `/host/listings/:listingId`

**Purpose:** Complete a draft, maintain a listing and make publication an informed action.

**Desktop:** Title/status header; sidebar/anchor sections Basics, Description & amenities, Photos, Pricing & policy, Review; main form; persistent unsaved/save status. “Save changes” is primary during edits. “Review listing”/“Publish listing” appears when reviewing saved data. Keep essential fields in a short first section; do not force a long form before first save.

**Mobile:** Same sections as accordion/step-like navigation without hiding errors; sticky Save with unsaved indicator; review is a full-width section. Sections are not fake autosave boundaries.

**Data:** Use `api.listing(listingId)` to hydrate complete `ListingDetail` for owner; server `getListingForViewer` supports owner visibility of draft/paused homes. `api.hostListings` may supply status/management context but omits type/description/address/amenities and must not be the sole hydration source for expanded fields. `updateListing` accepts supported partial `ListingInput`. Do not reset form from a background refetch while dirty or overwrite omitted fields with empty values.

**Sections:** Basics: existing title/type/city/region/country/time zone/capacity. Description and supported amenities: description, bedrooms, beds, wifi, kitchen, fireplace, courtyard; absence differs from false. Photos: existing presign → upload → attach sequence; JPEG/PNG/WebP/AVIF supported; permitted types/size limits verified against storage implementation. Pricing: nightly rate, deposit and exact 30-night illustrative calculation; configured guest fee is explanatory, not editable. Policy: existing flexible/moderate/strict values with corresponding approved terms. Instant-book toggle only if behavior is verified and communicated accurately; do not imply approval workflows.

**Photos:** Show attachment success only after the record exists. Upload progress/errors per file; sequential uploads are acceptable. Reordering/cover-photo picker is not available in current API and must not appear functional without added endpoint support. Removal confirms target photo when valuable; do not pretend an undo endpoint exists. Display existing sort order.

**Publish review:** Show saved fields, image presence, rate/deposit/policy and payout readiness. Missing required fields cannot save; missing photos/description should warn and link to sections under current permissive publish contract. If stricter quality checks are adopted, implement shared/server eligibility before claiming they are required. Final action PATCHes `status: active`; show success only after response. A public-but-unbookable listing shows an explicit payout setup next step. Pausing uses `status: paused` with explanation and confirmation; existing bookings remain represented in their own records.

**States:** Owner-only loading/not-found; saved/unsaved/saving; upload failure after file upload but before attach; validation error; publish/pause/delete failure; state changed on server. Navigate-away prompt only for actual unsaved edits. Success shows saved time based on confirmed local mutation result, not a fabricated backend timestamp.

**Accessibility/acceptance:** Keyboard section navigation and photo controls; error summary links to hidden sections; decimal input handled without float corruption; editing listing A then B does not retain A's values; owner draft works through direct load; optional field omissions are preserved; public cards invalidate after successful edits/publication.

### S14 — Payouts `/host/payouts`

**Purpose/action:** Establish ability to accept payment and inspect real payouts; Continue to Stripe or Refresh status.

**Desktop:** Account readiness card at top, then ledger table Amount/State/Paid date/Booking reference. Ready state should be compact. No “Next payout” inferred from the first array item and no bank-arrival date without source data.

**Mobile:** Ledger rows become labeled stacked cards, keep amount and state visible. Stripe handoff is clearly labeled as leaving Stead; back/return action restores home setup context when available.

**Data:** `api.connectStatus`, `api.connectOnboard`, `api.hostPayouts`. Readiness is `chargesEnabled && payoutsEnabled`, not `detailsSubmitted` alone. Respect existing `done=1` / `refresh=1` return semantics; do not derive success just from query parameters. Ledger states scheduled/paid/frozen/failed remain distinct. “Paid” ledger entry does not mean arrived at bank.

**States:** No account; details incomplete; submitted/pending review; charges or payouts disabled; ready; expired onboarding link; provider/API unavailable; ledger loading/empty/error. Limited polling after return may refresh actual readiness, but do not promise approval “in a few minutes.” Unsupported actions such as manually releasing payout are omitted.

**Accessibility/acceptance:** Table headings and mobile labels; state text; external transition clear; no sensitive bank fields rendered or logged; return readiness verified; payout UI does not claim host keeps 100% or instant check-in payout.

## 8. Communication and claims

### S07 — Inbox `/messages`

**Purpose/action:** See conversations and respond; open a thread.

**Desktop:** Optional two-pane layout: thread list left, selected conversation right once routed to S09. At bare inbox route show a helpful selection state in the right pane. Thread rows show counterpart, home, last message, last timestamp and unread count. No fake online presence or typing indicators.

**Mobile:** Full-width inbox; selecting row opens conversation screen. Latest activity sorts only on real `lastAt`; unread count accompanies accessible text.

**Data:** `api.messageThreads`, `api.unreadCount`. One account may hold renter and host conversations; no identity lock. A role-filter control requires role information or explicitly derived verified context, so omit unless supported.

**States:** Loading; empty “Messages with hosts and guests appear here”; Find a home/Your homes links; error with Retry; unread refresh failures do not erase threads.

**Accessibility/acceptance:** Entire thread row has clear accessible name, timestamp and unread label; narrow layout does not truncate every distinguishing detail; route preserves exact listing/guest pair and no other-party data leaks.

### S08 — Conversation shortcut `/messages/:listingId`

**Purpose/action:** Resolve the signed-in guest's listing-specific thread without losing context.

**Layout:** Focused “Opening conversation…” state with accessible status. No lasting separate visual screen.

**Data:** Wait for session; signed-out → safe login next containing this route; signed-in → `/messages/{listingId}/{user.id}` with replace navigation. Validate listing ID and let server ownership rules reject invalid/self-message cases. Existing owners should use their known guest thread, not resolve a self-thread.

**States:** Session loading, auth needed, invalid identifier, unavailable conversation. A redirect failure must offer Back to home rather than spin forever.

**Accessibility/acceptance:** Announcement only once; no navigation loop; exact listing retained through email callback; shortcut does not create an unauthorized guest identity.

### S09 — Conversation `/messages/:listingId/:guestId`

**Purpose/action:** Ask and answer questions with booking/home context; Send message.

**Desktop:** Two-pane inbox/conversation where appropriate; conversation header with counterpart and home link; messages with date separators/times; persistent composer. Show only supported home context and any returned booking ID; no fabricated booking controls.

**Mobile:** Focused header with Back to inbox; messages then bottom composer respecting keyboard/safe area. Scroll newest content into view only when already near the bottom or after own send; do not yank the user from an older message.

**Data:** `api.thread`, `api.markThreadRead`, `api.sendMessage`. Host sends guestId from authorized thread context; guest identity remains server-derived. Plain text up to existing 4,000 characters. No attachment/voice message/file-sharing affordance without API support. Preserve unsent draft on send failure within session; do not put it in URL or analytics.

**States:** Loading; no messages (“Ask a question about this home”); sending; sent; send failure retains text and supports explicit retry; unauthorized/not found; network-refresh state. Do not optimistically mark sent before API acknowledgment or append duplicates on retry/refetch.

**Accessibility/acceptance:** Composer visible label, character limit feedback near limit, conventional Enter adds newline with explicit Send (optional documented Ctrl/Cmd+Enter shortcut); new-message announcements don't reread history. Mark-read only after conversation successfully loads/visible; unread queries refresh; XSS content renders as text.

### S15 — Claims `/host/claims`

**Purpose/action:** Find claims involving this account; open a claim.

**Desktop/mobile:** Neutral “Claims” header with description; list of home/stay/amount/status rows, expandable to card layout on mobile. Existing route name remains for compatibility, but guest visitors must not be forced into host navigation. Use actual claim data/entry context to choose shell; shared claims labels remain role-neutral.

**Data:** `api.claims()` returns permitted claims. Optional Open/Resolved grouping derives from existing ClaimState. Do not invent response deadlines not returned by API. Claim creation remains tied to an eligible stay at S06.

**States:** Loading/error/auth; no claims is a calm state (“You have no claims to review”), not an invitation to make one. Resolved claims remain available for recordkeeping.

**Accessibility/acceptance:** Amount/state in text; status cannot be color-only; no all-caps labels too small to read; guest can reach their claim without becoming a homeowner; server scoping preserved.

### S16 — Claim detail `/host/claims/:claimId`

**Purpose:** Review evidence and make authorized, deliberate financial decisions.

**Desktop:** Claim amount/state and stay summary; description and evidence in main column; permitted response/status panel to the side. Resolution summary with amount/note/date when returned. Link back to stay. Title is “Claim details,” independent of viewer role.

**Mobile:** Summary → description → evidence → response. Keep Accept/Dispute equally legible; never conceal the alternative below a promotional section. Sticky destructive action is unnecessary.

**Data:** `api.claim`, `respondClaim`, `resolveClaim`, evidence presign/upload/attach. Use `viewerRole`, `canRespond`, `canResolve`, `canFileEvidence` from server. Host/guest/arbiter state changes are never inferred solely from URL or a UI workspace. Display all `CLAIM_STATE_LABEL` states distinctly: open, guest accepted, guest disputed, arbitration, resolved host/guest/split.

**Actions:** Evidence upload retains optional note, shows author where supported, succeeds only after attach. Guest Accept opens a confirmation naming amount and consequence before submission. Dispute confirms intended choice with factual “Record dispute” language; do not guarantee independent arbitration. Arbiter-only form offers host, guest, split, plus resolution note; split validation is positive cents within allowed amount; review chosen outcome before final resolve. Server rejects stale action, then refreshes latest claim.

**States:** Loading/not found/error/auth; no evidence; upload pending/failure/attached; response pending/recorded; resolution pending/resolved. A submitted response doesn't immediately mean money moved: use returned claim/payment state. Resolved claims hide further actions according to flags.

**Accessibility/acceptance:** Evidence has human-accessible image alternative from note when provided, otherwise neutral numbered label; full-size viewing with focus support; no cropped evidence as the only view; financial confirmation keyboard accessible; each role sees only authorized controls; duplicate resolve/accept suppressed; mutation errors preserve drafts/notes.

## 9. Operations and fallback

### S17 — Operations `/ops`

**Purpose/action:** Let authorized operators inspect financial exceptions and job health; Refresh snapshot.

**Desktop:** Wide utilitarian layout using the same typography/colors: heading and fetched-at indicator, summary counts derived from current arrays, then Disputes, Job health, Frozen payouts. Dense semantic tables retain exact IDs, timestamps and states. No decorative dashboard charts.

**Mobile:** Stacked record cards with labeled fields, safe wrapping for IDs and explicit time-zone context. Technical IDs/error details belong here, not in customer copy; display errors as text, never executable HTML.

**Data:** `api.ops()` only. `SessionResponse.isOps` controls navigation visibility; server 403 remains authoritative. No buttons for releasing funds, closing disputes, rerunning jobs or editing roles: these mutation APIs do not exist. A link to booking detail is conditional on resource availability/permission; ops access alone must not imply party access to S06.

**States:** Session/load; forbidden with clear account-access message; snapshot error with Retry; empty disputes/frozen payouts; no heartbeat yet versus healthy heartbeat; stale/errored/OK; refreshing retains prior data with clearly displayed prior fetch time. A fetch timestamp is client snapshot time, not a fabricated server event.

**Accessibility/acceptance:** Semantic headers, searchable/copyable IDs only as presentation if implemented; color supplemented with labels; unauthorized direct link denied; no sensitive data leaks to public analytics; healthy counts never treat missing data as zero/healthy.

### S19 — Unknown route `*`

**Purpose/action:** Explain a broken link and help recover instead of silently landing in search.

**Desktop/mobile:** Shared public shell, “We couldn't find that page,” Back and Find a home actions; homeowner can also choose Your homes if signed in. Compact, accessible, no whimsical animation.

**Data:** No API needed. The route should preserve requested path only for safe diagnostic logging, with sensitive query data stripped. Do not render arbitrary query text or try to fetch guessed resources.

**States:** Deliberate not-found view. Listing/trip/claim not-found remain resource-specific screens above.

**Accessibility/acceptance:** Document title identifies not found; focus on main heading; routes with refreshed deep links resolve correctly through hosting configuration; unknown path doesn't silently count as a successful explore visit.

## 10. Done means complete behavior

A screen is finished when its desktop/mobile composition, actual data contract, full state set, accessible interactions and main onward path meet these specifications. Shipping only the landing page is not this brief. Keep route compatibility, financial semantics, guest/host permissions, communications, claim/review/cancellation workflows and ops visibility intact while replacing the visual layer. Resolve engineering blockers using the linked build plan; do not hide an unsupported behavior behind polished copy.
