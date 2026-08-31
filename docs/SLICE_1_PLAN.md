# Slice 1 — Foundation + guest booking (plan, awaiting approval)

Scope per BUILD_PROMPT §10 S1: auth, profiles, seed, `/explore`, `/listing/:id`,
create-booking + Stripe test payment, `/trips`.

## Migration

`supabase/migrations/20260901000000_slice1_foundation.sql` — written, **not yet
applied**. Creates `app_config` (seeded with the §3 constants), `profiles` (+
auto-create trigger on `auth.users`), `listings`, `listing_photos`,
`listing_blackouts`, `bookings`, `stripe_events`.

Deliberately scoped to Slice 1's tables. Escrow, claims, reviews, payouts,
refunds, disputes, heartbeats and the `trust_stats` view land in their own
slices — several depend on tables that do not exist yet, so front-loading the
whole of §4 would mean editing applied migrations later.

Two load-bearing details:

- `bookings.stay` is a generated `daterange` with a partial GiST exclusion
  constraint over `(listing_id, stay)` for statuses
  `pending_payment | confirmed | checked_in`. Availability is enforced *only*
  here; app code inserts and surfaces a friendly conflict on `23P01`.
- RLS is deny-by-default everywhere. `bookings` has a SELECT policy for the
  guest and the listing's host, and **no** insert/update/delete policy — every
  write goes through an edge function on the service role.

## File tree

```
package.json · tsconfig.json · vite.config.ts · tailwind.config.ts · index.html
src/
  main.tsx · App.tsx · index.css            # router, QueryClient, token layer
  lib/
    supabase.ts                             # browser client (anon key)
    money.ts                                # integer-cent math; no floats
    dates.ts                                # date-fns-tz, listing-local time
    format.ts                               # currency w/ tabular numerals
  types/database.ts                          # generated from the schema
  components/
    ui/{Button,Input,Card,Badge,Spinner,EmptyState,ErrorState}.tsx
    layout/{AppShell,Header,Footer}.tsx
    listing/{ListingCard,PhotoGallery,AvailabilityCalendar,PriceBreakdown}.tsx
  routes/
    login.tsx · auth-callback.tsx           # magic link only (Google deferred)
    explore.tsx · listing-detail.tsx
    checkout.tsx                            # Stripe Payment Element
    trips.tsx
  hooks/{useSession,useListings,useListing,useBookings}.ts
supabase/
  migrations/20260901000000_slice1_foundation.sql
  functions/
    _shared/{pricing.ts,cors.ts,supabase.ts}
    create-booking/index.ts                 # prices + inserts pending_payment
    expire-pending-bookings/index.ts        # cron, TTL from app_config
    stripe-webhook/index.ts                 # extend bootstrap → idempotent
  seed/seed.ts                              # 1 host, 6 listings, mixed tz
tests/
  pricing.test.ts · overlap.test.ts · expire.test.ts
```

## Pricing (server-side only, snapshotted onto the booking)

`stay_subtotal = nightly_rate × nights` ·
`network_fee = subtotal × network_fee_bps / 10000` ·
`guest_total = subtotal + network_fee`. Deposit stays separate and is never
summed into `guest_total`. Reference case: $200 × 5 → guest $1,020, host
$1,000, $300 deposit held apart.

## Tests (Vitest, required green before the slice closes)

- `pricing.test.ts` — table-driven cents math incl. rounding and the §3 case.
- `overlap.test.ts` — a second overlapping booking fails on the exclusion
  constraint; a back-to-back booking (checkout == next check-in) succeeds,
  proving the `[)` bound.
- `expire.test.ts` — `pending_payment` past TTL flips to `expired` and frees
  the dates.

Accept: happy path in Stripe test mode, plus an RLS probe showing guest A
cannot read guest B's booking.

## Blocked / open

- Checkout needs `STRIPE_SECRET_KEY` + `VITE_STRIPE_PUBLISHABLE_KEY`. Schema,
  seed, explore, listing detail and the RLS probe do not.
- Auth is magic-link only; Google OAuth deferred per CLAUDE.md.
- Photos use picsum seeds until real photography lands.
