/**
 * create-booking, formerly a Supabase edge function running with the service
 * role. Same rules: quote from app_config, snapshot the money onto the row,
 * insert pending_payment + escrow scheduled, hand back Stripe client secrets.
 *
 * The guest id comes from the session cookie, never from the request body.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { depositMethod, MoneyError, nightsBetween, quoteStay } from "../lib/pricing";
import { getStripe, stripeConfigured } from "../lib/stripe";
import { sessionUser, type AppEnv } from "../lib/http";
import {
  createBookingWithEscrow,
  DateConflictError,
  getBookableListing,
  getTripForParty,
  listTripsForGuest,
  overlapsBlackout,
} from "../queries/bookings";
import { getConfigMap, intFromConfig } from "../queries/listings";
import type { CreateBookingResponse } from "../../src/lib/types";

const createBookingSchema = z.object({
  listingId: z.string().uuid(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1),
});

export const tripsRoutes = new Hono<AppEnv>();

tripsRoutes.get("/", async (c) => {
  return c.json(await listTripsForGuest(c.get("db"), sessionUser(c).id));
});

tripsRoutes.get("/:id", async (c) => {
  const trip = await getTripForParty(c.get("db"), c.req.param("id"), sessionUser(c).id);
  if (!trip) {
    throw new HTTPException(404, { message: "Trip not found" });
  }
  return c.json(trip);
});

export const bookingsRoutes = new Hono<AppEnv>();

bookingsRoutes.post("/", async (c) => {
  const guest = sessionUser(c);
  const db = c.get("db");

  const parsed = createBookingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: "listingId, checkIn, checkOut, and guests are required",
    });
  }
  const { listingId, checkIn, checkOut, guests } = parsed.data;

  let nights: number;
  try {
    nights = nightsBetween(checkIn, checkOut);
  } catch (err) {
    throw new HTTPException(400, {
      message: err instanceof MoneyError ? err.message : "Invalid stay dates",
    });
  }

  const listing = await getBookableListing(db, listingId);
  if (!listing) throw new HTTPException(404, { message: "Listing not found" });
  if (listing.status !== "active") {
    throw new HTTPException(409, { message: "This listing is not available" });
  }
  if (listing.hostId === guest.id) {
    throw new HTTPException(400, { message: "You cannot book your own listing" });
  }
  if (guests > listing.maxGuests) {
    throw new HTTPException(400, { message: `This home sleeps ${listing.maxGuests}` });
  }
  if (await overlapsBlackout(db, listingId, checkIn, checkOut)) {
    throw new HTTPException(409, { message: "Those dates are blocked on this listing" });
  }

  const config = await getConfigMap(db);
  const networkFeeBps = intFromConfig(config.network_fee_bps, 200);
  const depositAuthMaxNights = intFromConfig(config.deposit_auth_max_nights, 4);

  let quote;
  try {
    quote = quoteStay({
      nightlyRateCents: listing.nightlyRateCents,
      nights,
      networkFeeBps,
      depositCents: listing.depositCents,
    });
  } catch (err) {
    throw new HTTPException(400, {
      message: err instanceof MoneyError ? err.message : "Invalid quote",
    });
  }

  const method = depositMethod(nights, depositAuthMaxNights);

  let paymentIntentId: string;
  let paymentClientSecret: string | null = null;
  let setupIntentId: string;
  let setupClientSecret: string | null = null;
  let mockPayment = false;

  if (stripeConfigured()) {
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: quote.guest_total_cents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { listing_id: listingId, guest_id: guest.id },
    });
    paymentIntentId = paymentIntent.id;
    paymentClientSecret = paymentIntent.client_secret;

    const setupIntent = await stripe.setupIntents.create({
      usage: "off_session",
      metadata: { listing_id: listingId, guest_id: guest.id, deposit_method: method },
    });
    setupIntentId = setupIntent.id;
    setupClientSecret = setupIntent.client_secret;
  } else {
    mockPayment = true;
    paymentIntentId = `pi_mock_${crypto.randomUUID()}`;
    setupIntentId = `seti_mock_${crypto.randomUUID()}`;
  }

  let created;
  try {
    created = await createBookingWithEscrow(
      db,
      {
        listingId,
        guestId: guest.id,
        checkIn,
        checkOut,
        guests,
        nights: quote.nights,
        nightlyRateCents: quote.nightly_rate_cents,
        staySubtotalCents: quote.stay_subtotal_cents,
        networkFeeCents: quote.network_fee_cents,
        guestTotalCents: quote.guest_total_cents,
        depositCents: quote.deposit_cents,
        cancellationPolicy: listing.cancellationPolicy,
        status: "pending_payment",
        stripePaymentIntentId: paymentIntentId,
      },
      { amountCents: quote.deposit_cents, method, stripeSetupIntentId: setupIntentId },
      { method, nights, mock_payment: mockPayment },
    );
  } catch (err) {
    if (err instanceof DateConflictError) {
      throw new HTTPException(409, { message: err.message });
    }
    throw err;
  }

  if (stripeConfigured()) {
    await getStripe().paymentIntents.update(paymentIntentId, {
      metadata: { booking_id: created.bookingId, listing_id: listingId, guest_id: guest.id },
    });
  }

  const body: CreateBookingResponse = {
    bookingId: created.bookingId,
    quote,
    paymentClientSecret,
    setupClientSecret,
    depositMethod: method,
    mockPayment,
    timezone: listing.timezone,
  };
  return c.json(body);
});
