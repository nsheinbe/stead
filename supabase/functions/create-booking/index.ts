import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@18";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { depositMethod, nightsBetween, quoteStay } from "../_shared/pricing.ts";

type CreateBookingBody = {
  listing_id?: string;
  check_in?: string;
  check_out?: string;
  guests?: number;
};

function intFromConfig(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: "Server is missing Supabase env vars" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Sign in to book" }, 401);
  }
  const guestId = userData.user.id;

  let body: CreateBookingBody;
  try {
    body = (await req.json()) as CreateBookingBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const listingId = body.listing_id;
  const checkIn = body.check_in;
  const checkOut = body.check_out;
  const guests = body.guests;
  if (!listingId || !checkIn || !checkOut || !Number.isInteger(guests) || (guests ?? 0) < 1) {
    return jsonResponse({ error: "listing_id, check_in, check_out, and guests are required" }, 400);
  }

  let nights: number;
  try {
    nights = nightsBetween(checkIn, checkOut);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Invalid dates" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: listing, error: listingError } = await admin
    .from("listings")
    .select(
      "id, host_id, status, nightly_rate_cents, deposit_cents, max_guests, cancellation_policy, timezone",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (listingError || !listing) {
    return jsonResponse({ error: "Listing not found" }, 404);
  }
  if (listing.status !== "active") {
    return jsonResponse({ error: "This listing is not available" }, 409);
  }
  if (listing.host_id === guestId) {
    return jsonResponse({ error: "You cannot book your own listing" }, 400);
  }
  if (guests > listing.max_guests) {
    return jsonResponse({ error: `This home sleeps ${listing.max_guests}` }, 400);
  }

  const { data: blackouts } = await admin
    .from("listing_blackouts")
    .select("start_date, end_date")
    .eq("listing_id", listingId);

  const overlapsBlackout = (blackouts ?? []).some((b: { start_date: string; end_date: string }) => {
    return checkIn < b.end_date && checkOut > b.start_date;
  });
  if (overlapsBlackout) {
    return jsonResponse({ error: "Those dates are blocked on this listing" }, 409);
  }

  const { data: configRows, error: configError } = await admin.from("app_config").select("key, value");
  if (configError || !configRows) {
    return jsonResponse({ error: "Fee policy is unavailable" }, 500);
  }
  const config = Object.fromEntries(configRows.map((row: { key: string; value: unknown }) => [row.key, row.value]));
  const networkFeeBps = intFromConfig(config.network_fee_bps, 200);
  const depositAuthMaxNights = intFromConfig(config.deposit_auth_max_nights, 4);

  let quote;
  try {
    quote = quoteStay({
      nightlyRateCents: listing.nightly_rate_cents,
      nights,
      networkFeeBps,
      depositCents: listing.deposit_cents,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Invalid quote" }, 400);
  }

  const method = depositMethod(nights, depositAuthMaxNights);
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const stripeReady = stripeSecret.startsWith("sk_");

  let paymentIntentId: string | null = null;
  let paymentClientSecret: string | null = null;
  let setupIntentId: string | null = null;
  let setupClientSecret: string | null = null;
  let mockPayment = false;

  if (stripeReady) {
    const stripe = new Stripe(stripeSecret);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: quote.guest_total_cents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { listing_id: listingId, guest_id: guestId },
    });
    paymentIntentId = paymentIntent.id;
    paymentClientSecret = paymentIntent.client_secret;

    const setupIntent = await stripe.setupIntents.create({
      usage: "off_session",
      metadata: { listing_id: listingId, guest_id: guestId, deposit_method: method },
    });
    setupIntentId = setupIntent.id;
    setupClientSecret = setupIntent.client_secret;
  } else {
    mockPayment = true;
    paymentIntentId = `pi_mock_${crypto.randomUUID()}`;
    setupIntentId = `seti_mock_${crypto.randomUUID()}`;
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .insert({
      listing_id: listingId,
      guest_id: guestId,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      nights: quote.nights,
      nightly_rate_cents: quote.nightly_rate_cents,
      stay_subtotal_cents: quote.stay_subtotal_cents,
      network_fee_cents: quote.network_fee_cents,
      guest_total_cents: quote.guest_total_cents,
      deposit_cents: quote.deposit_cents,
      cancellation_policy: listing.cancellation_policy,
      status: "pending_payment",
      stripe_payment_intent_id: paymentIntentId,
    })
    .select("id")
    .single();

  if (bookingError || !booking) {
    const conflict =
      bookingError?.code === "23P01" ||
      bookingError?.message?.toLowerCase().includes("exclusion") ||
      bookingError?.message?.toLowerCase().includes("no_overlap");
    if (conflict) {
      return jsonResponse(
        { error: "Those dates were just taken. Try another stay — the calendar is the lock." },
        409,
      );
    }
    return jsonResponse({ error: bookingError?.message ?? "Could not create booking" }, 400);
  }

  const { data: deposit, error: depositError } = await admin
    .from("escrow_deposits")
    .insert({
      booking_id: booking.id,
      amount_cents: quote.deposit_cents,
      state: "scheduled",
      method,
      stripe_setup_intent_id: setupIntentId,
    })
    .select("id")
    .single();

  if (depositError || !deposit) {
    await admin.from("bookings").update({ status: "expired" }).eq("id", booking.id);
    return jsonResponse({ error: "Could not schedule the deposit in neutral escrow" }, 500);
  }

  await admin.from("escrow_audit").insert({
    deposit_id: deposit.id,
    from_state: null,
    to_state: "scheduled",
    actor: "create-booking",
    meta: { method, nights, mock_payment: mockPayment },
  });

  if (stripeReady && paymentIntentId) {
    const stripe = new Stripe(stripeSecret);
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { booking_id: booking.id, listing_id: listingId, guest_id: guestId },
    });
  }

  return jsonResponse({
    booking_id: booking.id,
    quote,
    payment_client_secret: paymentClientSecret,
    setup_client_secret: setupClientSecret,
    mock_payment: mockPayment,
    deposit_method: method,
    timezone: listing.timezone,
  });
});
