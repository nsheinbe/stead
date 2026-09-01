// Creates a booking. This is the only place stay pricing is authoritative:
// the client's breakdown is a display of the same shared module, but the
// numbers written to the row are computed here, from app_config and the
// listing, and snapshotted onto the booking.
//
// Availability is never checked in code. We insert and let the btree_gist
// exclusion constraint arbitrate; a 23P01 means someone else won the race.
import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@18'
import { nightsBetween, priceBooking } from '../_shared/pricing.ts'
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

const UNIQUE_VIOLATION = '23505'
const EXCLUSION_VIOLATION = '23P01'

interface CreateBookingBody {
  listing_id?: unknown
  check_in?: unknown
  check_out?: unknown
  guests?: unknown
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Use POST.', 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return errorResponse('unauthenticated', 'Sign in to book.', 401)
  }

  // Identify the caller with their own token, so the guest is the session
  // user and never something the client can assert.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await asCaller.auth.getUser()
  if (userError || !userData.user) {
    return errorResponse('unauthenticated', 'Sign in to book.', 401)
  }
  const guestId = userData.user.id

  let body: CreateBookingBody
  try {
    body = await req.json()
  } catch {
    return errorResponse('bad_request', 'Body must be JSON.', 400)
  }

  const { listing_id: listingId, check_in: checkIn, check_out: checkOut } = body
  const guests = Number(body.guests)

  if (typeof listingId !== 'string' || !isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return errorResponse('bad_request', 'listing_id, check_in and check_out are required.', 400)
  }
  if (!Number.isInteger(guests) || guests < 1) {
    return errorResponse('bad_request', 'guests must be a positive integer.', 400)
  }

  let nights: number
  try {
    nights = nightsBetween(checkIn, checkOut)
  } catch {
    return errorResponse('bad_request', 'Check-out must be after check-in.', 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: listing, error: listingError } = await admin
    .from('listings')
    .select('id, nightly_rate_cents, deposit_cents, max_guests, cancellation_policy, status')
    .eq('id', listingId)
    .maybeSingle()

  if (listingError) return errorResponse('server_error', 'Could not load the listing.', 500)
  if (!listing || listing.status !== 'active') {
    return errorResponse('not_found', 'That listing is not available.', 404)
  }
  if (guests > listing.max_guests) {
    return errorResponse(
      'too_many_guests',
      `This home sleeps ${listing.max_guests}.`,
      400,
    )
  }

  // A blackout is the host's own hold; the exclusion constraint does not
  // cover it, so it is checked here.
  const { data: blackouts, error: blackoutError } = await admin
    .from('listing_blackouts')
    .select('id')
    .eq('listing_id', listingId)
    .lt('start_date', checkOut)
    .gt('end_date', checkIn)
    .limit(1)

  if (blackoutError) return errorResponse('server_error', 'Could not check availability.', 500)
  if (blackouts && blackouts.length > 0) {
    return errorResponse('dates_unavailable', 'Those dates are not available.', 409)
  }

  const { data: feeRow, error: feeError } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'network_fee_bps')
    .single()

  if (feeError || feeRow === null) {
    return errorResponse('server_error', 'Pricing configuration is unavailable.', 500)
  }
  const networkFeeBps = Number(feeRow.value)
  if (!Number.isInteger(networkFeeBps)) {
    return errorResponse('server_error', 'Pricing configuration is invalid.', 500)
  }

  const price = priceBooking({
    nightlyRateCents: listing.nightly_rate_cents,
    nights,
    depositCents: listing.deposit_cents,
    networkFeeBps,
  })

  const { data: booking, error: insertError } = await admin
    .from('bookings')
    .insert({
      listing_id: listingId,
      guest_id: guestId,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      nights,
      nightly_rate_cents: price.nightlyRateCents,
      stay_subtotal_cents: price.staySubtotalCents,
      network_fee_cents: price.networkFeeCents,
      guest_total_cents: price.guestTotalCents,
      deposit_cents: price.depositCents,
      cancellation_policy: listing.cancellation_policy,
      status: 'pending_payment',
    })
    .select('id, guest_total_cents')
    .single()

  if (insertError) {
    if (insertError.code === EXCLUSION_VIOLATION || insertError.code === UNIQUE_VIOLATION) {
      return errorResponse(
        'dates_unavailable',
        'Someone just booked those dates. Try different ones.',
        409,
      )
    }
    return errorResponse('server_error', 'Could not create the booking.', 500)
  }

  // The booking now holds the dates. Payment comes second on purpose: if this
  // fails, the pending row expires on its TTL rather than leaking a charge.
  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      'payments_unconfigured',
      'Payments are not configured on this environment.',
      503,
    )
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY)
  let clientSecret: string | null = null
  try {
    const intent = await stripe.paymentIntents.create({
      amount: booking.guest_total_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { booking_id: booking.id, guest_id: guestId },
    })
    clientSecret = intent.client_secret
    await admin
      .from('bookings')
      .update({ stripe_payment_intent_id: intent.id })
      .eq('id', booking.id)
  } catch {
    return errorResponse('payment_setup_failed', 'Could not start payment.', 502)
  }

  return jsonResponse({
    booking_id: booking.id,
    client_secret: clientSecret,
    breakdown: price,
  })
})
