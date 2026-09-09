/**
 * Cancellation preview and the cancel-booking transition.
 *
 * The refund figure is computed in TypeScript (tested matrix in
 * tests/cancellation.test.ts) and handed to app.cancel_booking, which is the
 * only writer. Stripe lives in the route, outside this transaction.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import {
  canCancelStatus,
  msUntilListingLocalCheckIn,
  quoteCancellation,
} from "../lib/cancellation";
import type { CancellationPreview } from "../../src/lib/types";
import type { BookingStatus, CancellationPolicy } from "../../src/lib/types";
import { getConfigMap, stringFromConfig } from "./listings";

export class CancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelError";
  }
}

export type CancelableBooking = {
  id: string;
  status: BookingStatus;
  guestId: string;
  hostId: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  nightlyRateCents: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  guestTotalCents: number;
  depositCents: number;
  cancellationPolicy: CancellationPolicy;
  timezone: string;
  stripePaymentIntentId: string | null;
  stripeSetupIntentId: string | null;
  hostConnectAccountId: string | null;
  listingTitle: string;
};

export async function getCancelableBooking(
  tx: Tx,
  bookingId: string,
): Promise<CancelableBooking | null> {
  const rows = (await tx.execute(sql`
    SELECT b.id,
           b.status::text AS status,
           b.guest_id,
           l.host_id,
           b.listing_id,
           b.check_in::text,
           b.check_out::text,
           b.nights,
           b.nightly_rate_cents,
           b.stay_subtotal_cents,
           b.network_fee_cents,
           b.guest_total_cents,
           b.deposit_cents,
           b.cancellation_policy::text AS cancellation_policy,
           l.timezone,
           b.stripe_payment_intent_id,
           d.stripe_setup_intent_id,
           hp.stripe_connect_account_id,
           l.title
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.profiles hp ON hp.id = l.host_id
      LEFT JOIN public.escrow_deposits d ON d.booking_id = b.id
     WHERE b.id = ${bookingId}::uuid
  `)) as unknown as {
    id: string;
    status: BookingStatus;
    guest_id: string;
    host_id: string;
    listing_id: string;
    check_in: string;
    check_out: string;
    nights: number;
    nightly_rate_cents: number;
    stay_subtotal_cents: number;
    network_fee_cents: number;
    guest_total_cents: number;
    deposit_cents: number;
    cancellation_policy: CancellationPolicy;
    timezone: string;
    stripe_payment_intent_id: string | null;
    stripe_setup_intent_id: string | null;
    stripe_connect_account_id: string | null;
    title: string;
  }[];

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    guestId: row.guest_id,
    hostId: row.host_id,
    listingId: row.listing_id,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Number(row.nights),
    nightlyRateCents: Number(row.nightly_rate_cents),
    staySubtotalCents: Number(row.stay_subtotal_cents),
    networkFeeCents: Number(row.network_fee_cents),
    guestTotalCents: Number(row.guest_total_cents),
    depositCents: Number(row.deposit_cents),
    cancellationPolicy: row.cancellation_policy,
    timezone: row.timezone,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeSetupIntentId: row.stripe_setup_intent_id,
    hostConnectAccountId: row.stripe_connect_account_id,
    listingTitle: row.title,
  };
}

export async function previewCancellation(
  tx: Tx,
  booking: CancelableBooking,
  viewerId: string,
  now = new Date(),
): Promise<CancellationPreview> {
  const actor: "guest" | "host" = viewerId === booking.hostId ? "host" : "guest";
  const config = await getConfigMap(tx);
  const checkinLocalTime = stringFromConfig(config.checkin_local_time, "16:00");
  const msUntil = msUntilListingLocalCheckIn({
    now,
    checkIn: booking.checkIn,
    timezone: booking.timezone,
    checkinLocalTime,
  });
  const quote = quoteCancellation({
    actor,
    status: booking.status,
    policy: booking.cancellationPolicy,
    staySubtotalCents: booking.staySubtotalCents,
    networkFeeCents: booking.networkFeeCents,
    nightlyRateCents: booking.nightlyRateCents,
    depositCents: booking.depositCents,
    msUntilCheckIn: msUntil,
  });

  return {
    canCancel: canCancelStatus(booking.status) && (viewerId === booking.guestId || viewerId === booking.hostId),
    actor,
    policy: booking.cancellationPolicy,
    status: booking.status,
    refundCents: quote.refundCents,
    stayRefundCents: quote.stayRefundCents,
    feeRefundCents: quote.feeRefundCents,
    feeRetainedCents: quote.feeRetainedCents,
    firstNightRetainedCents: quote.firstNightRetainedCents,
    depositReleasedCents: quote.depositReleasedCents,
    band: quote.band,
    hoursUntilCheckIn: quote.hoursUntilCheckIn,
    afterCheckIn: quote.afterCheckIn,
    summary: quote.summary,
  };
}

export type CancelResult = {
  bookingId: string;
  newStatus: BookingStatus;
  refundId: string | null;
  guestEmail: string;
  hostEmail: string;
  listingTitle: string;
  guestName: string;
  hostName: string;
  depositReleased: boolean;
};

export async function cancelBooking(
  tx: Tx,
  bookingId: string,
  refundCents: number,
  stripeRefundId: string | null,
  asHost: boolean,
): Promise<CancelResult> {
  try {
    const rows = (await tx.execute(sql`
      SELECT booking_id,
             new_status::text AS new_status,
             refund_id,
             guest_email,
             host_email,
             listing_title,
             guest_name,
             host_name,
             deposit_released
        FROM app.cancel_booking(
          ${bookingId}::uuid,
          ${refundCents}::integer,
          ${stripeRefundId},
          ${asHost}::boolean
        )
    `)) as unknown as {
      booking_id: string;
      new_status: BookingStatus;
      refund_id: string | null;
      guest_email: string;
      host_email: string;
      listing_title: string;
      guest_name: string;
      host_name: string;
      deposit_released: boolean;
    }[];

    const row = rows[0];
    if (!row) throw new CancelError("this stay cannot be canceled");
    return {
      bookingId: row.booking_id,
      newStatus: row.new_status,
      refundId: row.refund_id,
      guestEmail: row.guest_email,
      hostEmail: row.host_email,
      listingTitle: row.listing_title,
      guestName: row.guest_name,
      hostName: row.host_name,
      depositReleased: row.deposit_released,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "this stay cannot be canceled";
    if (
      /not signed in|only the host|only the guest|cannot be canceled|no charge to refund|exceed guest_total|in full|claim is open|booking not found|non-negative/i.test(
        message,
      )
    ) {
      throw new CancelError(message.replace(/^ERROR:\s*/i, "").replace(/\s+Where:[\s\S]*$/, ""));
    }
    throw err;
  }
}
