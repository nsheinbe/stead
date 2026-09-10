# Stead — measurement and experiment contract

**Status:** proposed instrumentation, not existing analytics. No conversion baseline, traffic volume or uplift was supplied or measured. The baseline source contains the operational data needed for some outcomes, but this package does not claim a deployed analytics pipeline exists.

The redesign succeeds when more people become verified members and complete useful actions without more payment errors, unsuitable bookings or unusable listings. Track renter and homeowner journeys separately while retaining one member account model.

## 1. Definitions that cannot be changed by the browser

| Term | Definition | Must not count as this outcome |
|---|---|---|
| Email-link request | Auth endpoint accepts an attempt to send a sign-in link. | Typed email, viewed sign-in page, clicked button before response. |
| Verified first-time signup | A new member identity first reaches durable email-verified status through the valid Auth.js flow, once per member lifetime. | Email sent, link clicked without successful verification, a returning member signing in, a client event claiming `isNewUser`, Stripe Identity verification. |
| Returning sign-in | Successful authentication for an already-established member. | A new signup, account creation or new role assignment. |
| Renter activation | Member's first booking reaches durable server `confirmed` state, once per member lifetime. | Hold creation, button click, Payment Element return, `payment_intent.succeeded` before the server associates/confirms the correct booking, or mock payment outside test metrics. |
| Published home | Listing first changes to `active`, once per listing lifetime. | Clicked publish, unsaved review screen, local draft completion. |
| Ready home | Listing is `active`, passes the defined completeness checks, and its host's verified Connect status has `chargesEnabled` and `payoutsEnabled`. | `?done=1` on a return URL, `detailsSubmitted` alone, an account ID alone, or only `active` status. |
| Homeowner activation | Member has their first ready home under readiness policy v1, once per member lifetime. | Starting a draft, uploading a photo, publishing before payment readiness, predicted earnings or first payout. |
| Supply realization | First confirmed booking received by a homeowner, separately from ready-home activation. | Merely becoming ready or accepting an inquiry. |

Readiness policy v1 is a **measurement definition**, not a newly invented listing status or a silent change to publication rules. Proposed checks: valid required listing fields, at least one successfully attached photo, valid listing-local time zone, `active` status, and verified charge/payout capability. Optional home-detail fields remain optional; do not introduce a hidden description requirement through analytics. Existing server validation remains the minimum correctness gate. If the product chooses a different completeness threshold, version the policy and retain its historical version in the event. A ready home can still lack availability for a particular renter's dates; this metric does not promise universal bookability.

Email verification and government-ID verification are different. Auth.js owns member authentication. Stripe Identity changes trust status and must never emit a new signup event.

## 2. Audience attribution is not an account role

Use `intent: renter | homeowner | unknown` as the intent of a visit/action. It is an analytics label, not a new authorization attribute. Someone can enter through “List your home,” book a stay later, and appear in both relevant activity reports. Overall new-member totals count that member once.

Preserve two concepts:

- `signup_intent`: the validated acquisition intent associated with first verification, immutable once assigned or explicitly `unknown`.
- `event_intent`: what the member was doing for the event, such as renter checkout or homeowner setup. This can change between actions.

Never set `profiles.is_host`, `is_ops`, arbiter status, RLS identity or payment permissions from these fields. Existing application/database authorization remains independent.

Store attribution only as allowlisted labels: source placement, supported campaign code, experiment assignment and a short-lived opaque journey ID. Use a server-validated continuation/cookie or signed non-sensitive state to carry labels through an email callback. The label can be trusted as a validated label, not as proof of identity. Do not include raw query strings, arbitrary referrers or a private booking draft in an email link.

If email opens on another device without recoverable attribution, or consent/storage restrictions remove the anonymous link, retain `unknown`. Do not infer “homeowner” from a later host action and rewrite acquisition history. Auth must work regardless of attribution availability.

## 3. Vendor-neutral event schema

Implement a small typed adapter in proposed `src/lib/analytics.ts`, with runtime allowlist validation on any receiving server endpoint. The initial sink can be an approved internal collector or a disabled adapter plus local test sink. External vendor wiring is optional and must not be confused with completing durable outcome facts.

Common envelope:

```ts
type MeasurementEnvelope = {
  schema_version: 1;
  event_id: string;                 // opaque UUID; stable across retries
  event_name: AllowedEventName;
  occurred_at: string;              // UTC; server authority for durable outcomes
  received_at?: string;             // assigned by collector, not client
  origin: "client" | "server";
  environment: "development" | "test" | "staging" | "production";
  release_id: string;               // build identifier, bounded
  journey_id?: string;              // opaque, short-lived, consent-aware
  anonymous_id?: string;            // only if permitted; no fingerprinting
  member_key?: string;              // server-derived pseudonymous key, never email
  event_intent: "renter" | "homeowner" | "unknown";
  signup_intent?: "renter" | "homeowner" | "unknown";
  route_name?: AllowedRouteName;    // "listing_detail", not a full URL
  source?: AllowedSource;
  experiment?: { key: string; variant: string };
  properties: AllowedPropertiesForEvent;
};
```

Exported pseudonymous identifiers are still user-linked data; handle them under the product's privacy/retention rules. The promise here is **no direct personal content or secrets in event payloads**, not that pseudonymous analytics ceases to be data about people. Use a dedicated server-keyed pseudonym for `member_key`; do not send the email address or a reversible encoding of it. Internal operational facts may need member/listing/booking foreign keys under restricted access to compute outcomes; do not export them indiscriminately.

Allowlisted `source` examples: `landing_primary`, `landing_homeowner`, `homeowner_hero`, `header`, `mobile_nav`, `listing_booking`, `protected_deep_link`, `unknown`. Route names map to templates such as `home`, `explore`, `listing_detail`, `checkout`, `login`, `host_start`, `host_listing_edit`, `host_payouts`; never include dynamic IDs by serializing a URL.

Reject email, full name, exact address, latitude/longitude, selected travel dates, message/review/claim text, uploaded filenames/storage paths, evidence content, raw user agent, full IP, auth token, cookie, magic link, Stripe client secret, payment method/card details, account-link URL and arbitrary error strings. Use bounded error families instead: `network`, `validation`, `auth_required`, `auth_link_expired`, `conflict`, `rate_limited`, `unavailable`, `processor`, `unknown`. Maintain operational diagnostic logs separately with their existing access and redaction controls.

### Event catalog

| Event | Producer / trigger | Additional allowlisted properties | Dedupe rule |
|---|---|---|---|
| `journey_entered` | Client, first rendered relevant acquisition route for a new observed journey. | `entry_surface`, `intent` | One per journey + entry surface; track actual exposure, not prefetch. |
| `primary_action_selected` | Client, meaningful CTA activation. | `action: find_home \| list_home \| continue_checkout`, `placement` | Per interaction UUID; do not emit both touch and click. |
| `search_applied` | Client after supported search/filter update. | `has_location: boolean`, `guest_bucket`, `price_filter_set: boolean`, `result_count_bucket` | One per committed filter action, not each keystroke. No query text or city string. |
| `listing_viewed` | Client, detail loaded and visible. | `photo_count_bucket`, `availability_state` | One per journey + opaque listing key + view occurrence; no raw address. |
| `auth_link_requested` | Server accepts send request; provider acceptance is distinct from delivery. | `provider: email`, `intent`, `source` | Request id; resend remains a distinct attempt. |
| `auth_link_failed` | Client/server mapped failure, separated by producer. | `error_family`, `stage: request \| callback` | Request/callback attempt id; do not dedupe all failures for a user. |
| `signup_verified` | Server durable first verified identity fact. | `provider: email`, `cohort: new`, `attribution_state` | Unique `(signup_verified, member_id)` internally. |
| `signin_completed` | Server authenticated completion for an existing identity. | `provider: email`, `cohort: returning`, `attribution_state` | One per server auth-completion ID, not per `/api/me` call. |
| `draft_restored` | Client validates and restores selection draft. | `kind: booking_selection \| host_precreate`, `result: restored \| expired \| incompatible \| unavailable`, `age_bucket` | One per draft + restoration attempt; no draft values. |
| `checkout_reviewed` | Client, fresh valid quote reviewed. | `nights_bucket`, `deposit_method`, `quote_state: initial \| changed` | One per review instance/quote revision; no exact dates or secret. |
| `booking_pending_created` | Server commits a pending booking. | `is_first_booking_attempt`, `deposit_method` | Unique per booking creation, not per browser retry. |
| `deposit_setup_completed` | Server verifies the correct SetupIntent succeeded for this booking/account. | `deposit_method`, `attempt_number_bucket` | One per verified booking setup completion. |
| `checkout_failed` | Server/client mapped failure, distinguished by origin. | `stage: quote \| create \| setup \| payment \| confirmation`, `error_family` | Attempt id; not a fabricated booking outcome. |
| `booking_confirmed` | Server's booking transition succeeds. | `booking_key`, `is_first_confirmed_booking`, `deposit_method` | Unique per booking lifetime. |
| `renter_activated` | Durable first confirmed booking for a member. | `activation_policy: v1` | Unique per member lifetime. |
| `host_draft_created` | Server commits initial `draft` listing. | `listing_key`, `entry_surface` | Unique per listing, retries reuse fact. |
| `host_step_saved` | Server accepts a meaningful setup step save, or client observes accepted response with origin explicit. | `step: basics \| details \| price_policy \| photos \| review`, `save_state` | Listing + save revision/attempt; do not count auto-save heartbeats as progress. |
| `listing_published` | Server observes first draft/paused → active transition for listing. | `listing_key`, `readiness_state`, `readiness_policy: v1` | Once per listing first publication; later reactivation is a separate state-change event. |
| `payout_setup_started` | Server returns an onboarding URL. | `entry_surface`, `resumed: boolean` | Request id; never log URL or account ID. |
| `host_readiness_changed` | Server-observed listing/Connect/completeness change. | `ready: boolean`, `reason_code`, `readiness_policy: v1` | Listing + persisted readiness revision, or state-change fact id. |
| `homeowner_activated` | Server observes member's first ready home. | `activation_policy: v1` | Unique per member lifetime, independent of prerequisite order. |
| `host_first_booking_confirmed` | Server observes first confirmed reservation received by host. | `activation_policy: v1` | Unique per homeowner lifetime. |

`listing_key` and `booking_key` in exported events are optional pseudonymous dimension keys, not raw route fragments or externally resolvable URLs. Bucket definitions belong in versioned code, for example nights `30–59`, `60–89`, `90+`, not arbitrary frontend strings. Keep test/staging events physically or logically separated from production reporting.

## 4. Durable conversion facts and delivery

Client events are diagnostic and may be blocked or lost. Financial/authentication outcomes must be recoverable from server facts even with the browser closed.

### Required architecture

1. Add a minimal proposed `conversion_facts` table and optional delivery `measurement_outbox` in a new append-only migration. Neither table exists by assumption in the baseline. Keep only necessary internal identifiers, outcome type, occurred time, policy/release versions, safe attribution snapshot, stable event ID and delivery metadata. Unique constraints enforce each outcome's dedupe rule.
2. Write outcome facts atomically with the authoritative state where possible. For first email verification, use a narrowly scoped, owner-defined database trigger/function on the identity insert/verification transition, following the existing profile-trigger pattern. **Do not grant `auth_user` general access to tenant or analytics tables.** Validate actual Auth.js email-verification order against the installed version. Treat successful email verification as the signup fact; successful session completion is a separate event if needed.
3. Establish an instrumentation cutover. Backfill known pre-existing verified members into an exclusion/baseline registry so their first observed returning sign-in is never classified as new signup. Keep imported, seeded and historical/uncertain records out of new-cohort counts. Record historical facts as baseline/backfill with their provenance, not new events at migration time. Current `users.created_at` and `email_verified` are available, but a current timestamp from instrumentation is not a historical signup timestamp.
4. Auth source attribution may arrive separately from the verification fact. Attach it once via a validated auth-completion context linked to that member; preserve `unknown` if association cannot be established. Auth callback retries must not overwrite a first-source attribution with a later visit. Do not make email verification depend on external analytics availability.
5. For booking confirmation, append the fact/outbox write to the same database transaction/server transition that actually changes the booking to `confirmed`. Existing `stripe_events` first-claim behavior means an analytics write made only **after** that transaction can be lost forever on a retry. Use the transition result and a unique booking fact, not raw webhook receipt. Never make a remote analytics HTTP request inside the database transaction.
6. For homeowner readiness, recompute on both relevant paths: listing/photo/content/status changes and verified Connect readiness updates. Handle either order (publish then Connect, or Connect then publish). Append the first-ready fact transactionally where those prerequisites are persisted. A periodic reconciliation query must recover missed derived facts without counting them twice.
7. Delivery worker reads/claims bounded outbox batches through narrowly scoped server functions, sends outside transactions, and records acknowledgment/retry with backoff. Every retry retains the same `event_id`. Do not broaden `app_user` table grants or use the owner connection in runtime jobs. Authenticate any worker/cron route through the existing service boundary, and test its SQL privileges and allowed operations explicitly.
8. Keep external delivery optional: a disabled sink must not discard durable conversion facts, prevent sign-in, hold open a transaction, alter booking behavior or block listing saves. Provide a small restricted aggregate-query/export mechanism for baseline reporting even before an external vendor is wired.

Every new table needs an explicit data-access design. Deny raw member access to cross-member conversion facts/outbox; expose only necessary self-scoped attribution writes or ops aggregates through audited functions/policies. Add raw-SQL tests proving members cannot forge another member's fact, read the outbox, overwrite first activation, or elevate themselves. RLS remains required even when most access goes through functions.

### Reconciliation and duplicate scenarios

Test concurrent first bookings for one renter, two ready homes for one owner, duplicate Stripe event IDs, different Stripe events describing the same result, transaction rollback, process exit after fact commit but before delivery, vendor timeout after receiving an event, and Connect capability loss/regain. The lifetime activation fact is immutable; current readiness is a separate state metric and may become false.

When reconstructing a missed fact, derive `occurred_at` from the original durable transition/audit data where available. If unavailable, mark `reconciled_at` and an `unknown_original_time` quality flag rather than inventing an exact original time. Historical first conversions predating the redesign belong to baseline/history and do not enter the new-release numerator.

## 5. Reporting definitions

Use a documented reporting time zone for calendar cohorts; keep event timestamps in UTC. Report renter, homeowner and unknown acquisition intent separately, plus a deduplicated overall account total. Show traffic source, device class, release/experiment assignment and observation coverage alongside the totals.

| Metric | Numerator / denominator | Window and interpretation |
|---|---|---|
| Observed acquisition-to-signup conversion | Unique observed entrants linked to a first verified signup ÷ unique observed eligible entrants in the same acquisition cohort. | Deduplicate each anonymous journey/member at the cohort's first entry; mature for 7 days. Report unlinked verified signups separately, not forced into the denominator. |
| Email-link completion | Accepted link-request journeys resulting in valid authentication ÷ eligible accepted link-request journeys. | 24-hour maturity; new and returning members split after verification. Repeated resends within one journey do not become multiple prospective members. |
| New renter activation | New verified renter-intent members with first confirmed booking ÷ all new verified renter-intent members in the cohort. | 30-day maturity; report unknown/other-intent member renter activations separately. |
| Checkout completion | Unique committed pending bookings subsequently confirmed ÷ unique pending bookings created in the cohort. | 7-day observation with pending expiry classified separately. Also report member-level first-attempt conversion so duplicate attempts cannot inflate success. |
| New homeowner activation | New verified homeowner-intent members with first ready home ÷ all new verified homeowner-intent members in the cohort. | 30-day maturity; show distribution of time to readiness and incomplete step. |
| Listing readiness | Current ready listings ÷ current non-deleted draft/active/paused listings, with each status shown separately. | Snapshot metric; explicitly includes the effects of pauses/restrictions. Not a signup conversion rate. |
| Supply realization | Newly activated homeowners receiving first confirmed booking ÷ newly activated homeowners in cohort. | 60-day maturity; inventory/market demand can dominate this measure. |
| Data coverage | Observed/linked journeys and anonymous/unknown outcomes by reason. | Always shown with conversion rates so consent/storage loss is not mistaken for UX failure. |

The 7/24-hour/30/60-day windows above are proposed starting definitions, not evidence that these are Stead's actual decision cycles. Freeze definitions before baseline collection; revise later with a versioned change, not midway through an experiment to obtain a favorable result. Always distinguish mature cohorts from cohorts still in progress.

Guardrails: failed send/callback rate, actual setup/payment failure rate, duplicate/expired pending bookings, quote-change/conflict rate, 401/403/500 errors, unsigned/lagged webhook and refund-reconciliation issues, abandoned drafts, Connect restrictions, cancellation/refund/claim rates and meaningful support requests. Balance signup gains against activation, trust and payment correctness. No signup target can waive a financial or authorization regression.

## 6. Baseline and experiments

1. Deploy and validate instrumentation before changing substantial traffic where possible. Collect an initial baseline across at least two normal weekly cycles, or longer if traffic is insufficient. Report actual counts and uncertainty; do not invent a historical comparison from prototype use.
2. Baseline the two funnels and the current failure states separately. Segment known campaigns and device classes. Document inventory changes, traffic acquisition changes and seasonality that can confound before/after comparisons.
3. Start with hypothesis-driven tests only after core journey correctness is stable. Examples: showing “30 nights or more” before search reduces invalid checkout attempts; contextual homeowner continuation raises draft starts; clearer payable/deposit separation reduces payment-stage abandonment. These are hypotheses, not promised percentage uplifts.
4. Choose one primary outcome and a bounded set of guardrails before each experiment. Define eligibility, assignment unit, stable variant assignment, conversion window, minimum detectable effect and required sample from the measured baseline. With insufficient traffic, use staged rollout plus moderated usability tasks and label findings as directional.
5. Prefer stable member/anonymous-journey assignment so refreshes do not change the same person's journey. Preserve variant through auth where possible; unknown assignments remain unknown. Avoid simultaneously changing marketing traffic or supply policies without documenting the confound.
6. Evaluate after the planned sample/window; report absolute counts, rates and uncertainty. Do not declare a winner from a few sessions or repeated peeking. Financial/security regressions trigger immediate mitigation independently of sample size.
7. Archive experiment definition, release IDs, cohort queries, outcome counts, guardrails, instrumentation quality and decision. Keep the baseline available after rollout.

## 7. Grok delivery checklist

- Typed event definitions, bounded enums, redaction tests and documented event locations in code.
- Durable conversion schema/migrations, dedupe constraints, transaction integration, worker/reconciliation behavior and raw SQL authorization tests.
- Auth lifecycle tests proving first-time versus returning identity classification and attribution recovery/unknown behavior.
- Webhook/setup/host-readiness tests proving no duplicated or missing activation on replay, crash or prerequisite order changes.
- A seed-free production reporting query bundle or approved dashboard that computes the definitions above, with test/staging exclusion and cohort maturity labels.
- A baseline worksheet containing **actual observed results or blank “not measured” fields**, never fabricated uplift targets presented as results.
- External analytics configuration documented separately; missing vendor credentials do not excuse missing durable facts or falsify completion of a launch gate.
