# Prototype coverage and walkthrough

Open `prototype/index.html` after extracting the ZIP. Screen names in the toolbar are design views, not new production URL requirements. Use the Layout selector for the 390px composition; resize the browser for other sizes. The State selector previews loading/empty/error patterns. Returning to a screen link restores its normal state.

## Visual view → implementation route

| Preview | Current or proposed app route | Scope of illustration |
| --- | --- | --- |
| Homepage | `/` | Public acquisition, city entry, pricing hierarchy, homeowner entry |
| For homeowners | Proposed `/for-homeowners` | Homeowner proposition, setup sequence and signup entry |
| Find a home | `/explore` | Existing filter categories, one example result and no-match state |
| Home detail | `/listing/:id` | Property facts, host, policies and pricing card |
| Account / email link | `/login` | Contextual entry, sent/resend/change-email, simulated verification |
| Booking | `/book/:listingId` | Three steps with date/guest preservation during simulated email auth |
| Booking confirmed | State within existing booking/trip flow | Success-state reference, **not** a required new `/confirmation` route |
| Your stays | `/trips` | Renter booking index and empty/canceled examples |
| Stay details | `/trips/:bookingId` | Dates, host, receipt, deposit status, cancellation confirmation |
| Messages | `/messages`, `/messages/:listingId`, `/messages/:listingId/:guestId` | Inbox/thread visual; shortcut routing and party variants specified in writing |
| Profile / Trust Passport | `/passport/:userId` | Profile, honest empty reviews, own-profile identity action |
| Your homes | `/host/listings` | Draft/listed home, readiness checklist and resume |
| Guided listing / edit | Proposed `/host/start`; existing `/host/listings/:listingId` | Five groups: Basics → Home details → Price & policy → Photos → Review |
| Payouts | `/host/payouts` | Not-ready/ready examples and provider-handoff dialog |
| Claims | `/host/claims` | Claim summary and eligible-stay filing entry |
| Claim detail | `/host/claims/:claimId` | Guest response/evidence/confirmation pattern; other permissions in specs |
| Write a review | `/review/:bookingId` | Rating, optional text, pending-publication success |
| Operations | `/ops` | Restricted operational status; no invented money-movement actions |
| No standalone preview | Wildcard `*` | Existing fallback and malformed deep-link recovery specified in S19 |

The written screen specs cover all 18 existing route entries and fallback, including states not fully modeled in the offline demo. The visual reference deliberately consolidates related route variants into 18 selectable views.

## Try the two core journeys

**Renter:** Homepage → Find a home → Home detail → Choose dates → Review price and terms → Sign in → Continue with email → Simulate verification → Confirm & pay → Simulate payment → Confirmation → Stay details. Choose different dates before sign-in to inspect the preserved values. A stay under 30 nights is rejected in the preview. Payment and identity actions are simulations.

**Homeowner:** For homeowners → Create your listing → Email signup → Simulate verification → Basics → Home details → Price & policy → Save draft and add photos → Photos → Review → Simulate publish → Your homes → Payouts. Inspect the checklist before and after simulating a completed provider return. Production creates the real server draft at the end of Price & policy; it uploads photos only after a real ID exists.

**Recovery and consequential actions:** Select Login + Error to see expired-link recovery; choose a data screen + Empty/Loading/Error; use Stay details → Review cancellation; use Claim detail → Review acceptance or Dispute. Native dialogs show a separate confirmation before the simulated action.

## Deliberate limitations

- No network-backed product capabilities: no real auth, email, Stripe, identity verification, database, upload, message delivery, analytics or financial transaction.
- One fictional home image/record. No fake inventory depth, rating history or social proof.
- Booking selections and listing fields are kept only in JavaScript memory during the preview. Reload starts over. The actual durable/same-browser/cross-device behavior is defined in the engineering plan.
- Photo selection is not an upload and does not fabricate an attachment. Review text and messages are never transmitted.
- Default claims, trips and profiles can be selected directly to inspect their design without completing a fake signup. This is a preview control, not the production authorization model.
- Generic state examples communicate the design pattern. Production must implement the exact resource-specific recovery and permission states in the screen specs.
- The prototype has passed syntax, reference, token contrast and non-browser template-render checks. Browser interaction testing, screenshots and production accessibility certification were not performed for this handoff.

Use the prototype for hierarchy and visual direction. Use the route specs and build plan for complete behavioral requirements.
