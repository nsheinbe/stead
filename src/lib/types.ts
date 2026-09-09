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
export type ClaimState =
  | "open"
  | "guest_accepted"
  | "guest_disputed"
  | "arbitration"
  | "resolved_host"
  | "resolved_guest"
  | "resolved_split";

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

/** One step the deposit actually took, straight from escrow_audit. */
export type EscrowStep = {
  toState: EscrowState;
  at: string;
  actor: string;
};

export type EscrowDetail = {
  amountCents: number;
  state: EscrowState;
  heldAt: string | null;
  windowClosesAt: string | null;
  releasedAt: string | null;
  timeline: EscrowStep[];
};

export type TripDetail = TripSummary & {
  guests: number;
  nightlyRateCents: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  cancellationPolicy: CancellationPolicy;
  createdAt: string;
  escrow: EscrowDetail | null;
  claim: ClaimSummary | null;
  viewerIsHost: boolean;
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

/** A listing as its host sees it — including drafts and paused ones. */
export type HostListing = {
  id: string;
  title: string;
  city: string;
  country: string;
  timezone: string;
  nightlyRateCents: number;
  depositCents: number;
  maxGuests: number;
  status: ListingStatus;
  cancellationPolicy: CancellationPolicy;
  instantBook: boolean;
  photos: ListingPhoto[];
};

export type ListingInput = {
  title: string;
  description?: string;
  type: ListingType;
  addressLine?: string;
  city: string;
  region?: string;
  country: string;
  timezone: string;
  nightlyRateCents: number;
  depositCents: number;
  maxGuests: number;
  amenities?: ListingAmenities;
  instantBook?: boolean;
  cancellationPolicy?: CancellationPolicy;
  status?: ListingStatus;
};

/** Whether Stripe will actually let this host be paid. */
export type ConnectStatus = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export type PresignedUpload = {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresInSeconds: number;
};

export type HostPayout = {
  id: string;
  bookingId: string;
  amountCents: number;
  state: "scheduled" | "paid" | "frozen" | "failed";
  paidAt: string | null;
  stripeTransferId: string | null;
};

export type ClaimEvidenceItem = {
  id: string;
  uploadedBy: string;
  storagePath: string;
  note: string | null;
};

export type ClaimSummary = {
  id: string;
  bookingId: string;
  amountCents: number;
  description: string;
  state: ClaimState;
  createdAt: string;
  listingTitle: string;
  checkIn: string;
  checkOut: string;
};

export type ClaimDetail = ClaimSummary & {
  filedBy: string;
  resolvedAt: string | null;
  resolutionAmountCents: number | null;
  resolutionNote: string | null;
  evidence: ClaimEvidenceItem[];
  viewerRole: "host" | "guest" | "arbiter";
  canRespond: boolean;
  canResolve: boolean;
  canFileEvidence: boolean;
};

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  open: "Open",
  guest_accepted: "Guest accepted",
  guest_disputed: "Disputed",
  arbitration: "In arbitration",
  resolved_host: "Resolved — host",
  resolved_guest: "Resolved — guest",
  resolved_split: "Resolved — split",
};
