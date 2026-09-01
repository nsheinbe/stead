/**
 * The wire contract between the browser and /api. Shared by both sides, so a
 * change to a payload shape is a typecheck failure rather than a runtime
 * surprise. All money is integer cents.
 */
export type ListingType = "entire_home" | "apartment" | "private_room";
export type CancellationPolicy = "flexible" | "moderate" | "strict";
export type ListingStatus = "draft" | "active" | "paused";
export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "canceled_by_guest"
  | "canceled_by_host"
  | "expired";
export type EscrowState =
  | "scheduled"
  | "held"
  | "claim_window"
  | "released"
  | "claimed"
  | "disputed"
  | "arbitrated";

export type ListingAmenities = {
  bedrooms?: number;
  beds?: number;
  wifi?: boolean;
  kitchen?: boolean;
  fireplace?: boolean;
  courtyard?: boolean;
};

export type ListingPhoto = {
  id: string;
  storagePath: string;
  sortOrder: number;
};

export type HostSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ListingSummary = {
  id: string;
  title: string;
  type: ListingType;
  city: string;
  region: string;
  country: string;
  timezone: string;
  nightlyRateCents: number;
  depositCents: number;
  maxGuests: number;
  amenities: ListingAmenities;
  instantBook: boolean;
  cancellationPolicy: CancellationPolicy;
  photos: ListingPhoto[];
};

export type ListingDetail = ListingSummary & {
  description: string;
  addressLine: string;
  status: ListingStatus;
  host: HostSummary | null;
};

export type TripListing = {
  id: string;
  title: string;
  city: string;
  region: string;
  timezone: string;
  photos: ListingPhoto[];
};

export type TripSummary = {
  id: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  nights: number;
  guestTotalCents: number;
  depositCents: number;
  listing: TripListing;
};

export type TripDetail = TripSummary & {
  guests: number;
  nightlyRateCents: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  cancellationPolicy: CancellationPolicy;
  createdAt: string;
  escrow: { amountCents: number; state: EscrowState } | null;
};

/** Fee policy from app_config. Public: the 2% is the whole point. */
export type PublicConfig = {
  networkFeeBps: number;
  checkinLocalTime: string;
  checkoutLocalTime: string;
  claimWindowHours: number;
  pendingPaymentTtlMinutes: number;
};

export type SessionResponse = {
  user: { id: string; email: string; name: string | null } | null;
};

export type CreateBookingRequest = {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
};

export type CreateBookingResponse = {
  bookingId: string;
  quote: {
    nightly_rate_cents: number;
    nights: number;
    stay_subtotal_cents: number;
    network_fee_cents: number;
    guest_total_cents: number;
    deposit_cents: number;
  };
  paymentClientSecret: string | null;
  setupClientSecret: string | null;
  depositMethod: "auth_hold" | "card_on_file";
  mockPayment: boolean;
  timezone: string;
};

export const TYPE_LABEL: Record<ListingType, string> = {
  entire_home: "Entire home",
  apartment: "Apartment",
  private_room: "Private room",
};

export const POLICY_LABEL: Record<CancellationPolicy, string> = {
  flexible: "Flexible cancel",
  moderate: "Moderate cancel",
  strict: "Strict cancel",
};
