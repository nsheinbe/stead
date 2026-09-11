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
  method: DepositMethod;
  heldAt: string | null;
  windowClosesAt: string | null;
  releasedAt: string | null;
  timeline: EscrowStep[];
};

export type TripReviewState = {
  canReview: boolean;
  submitted: boolean;
  published: boolean;
};

export type CancelBand = "full" | "partial_first_night" | "half" | "none" | "pending" | "host";

export type CancellationPreview = {
  canCancel: boolean;
  actor: "guest" | "host";
  policy: CancellationPolicy;
  status: BookingStatus;
  refundCents: number;
  stayRefundCents: number;
  feeRefundCents: number;
  feeRetainedCents: number;
  firstNightRetainedCents: number;
  depositReleasedCents: number;
  band: CancelBand;
  hoursUntilCheckIn: number;
  afterCheckIn: boolean;
  summary: string;
};

export type TripParty = {
  id: string;
  displayName: string;
};

export type TripDetail = TripSummary & {
  guests: number;
  nightlyRateCents: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  /** Snapshotted at booking; never today's configuration. */
  networkFeeBps: number;
  cancellationPolicy: CancellationPolicy;
  createdAt: string;
  escrow: EscrowDetail | null;
  claim: ClaimSummary | null;
  viewerIsHost: boolean;
  review: TripReviewState;
  host: TripParty;
  guest: TripParty;
  cancellation: CancellationPreview;
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
  isOps?: boolean;
};

export type IdentitySessionResponse = {
  alreadyVerified: boolean;
  url: string | null;
};

export type OpsDispute = {
  id: string;
  paymentIntentId: string | null;
  bookingId: string | null;
  amountCents: number;
  status: string;
  createdAt: string;
  closedAt: string | null;
};

export type OpsHeartbeat = {
  job: string;
  lastOk: string | null;
  lastError: string | null;
  stale: boolean;
  errored: boolean;
};

export type OpsFrozenPayout = {
  id: string;
  bookingId: string;
  hostId: string;
  amountCents: number;
  state: string;
  paidAt: string | null;
  stripeTransferId: string | null;
};

/** Aggregate conversion counts. Never rows — ops sees how many, not who. */
export type OpsConversionTotal = {
  outcome: string;
  total: number;
  firstAt: string | null;
  lastAt: string | null;
};

export type OpsSnapshot = {
  disputes: OpsDispute[];
  heartbeats: OpsHeartbeat[];
  frozenPayouts: OpsFrozenPayout[];
  conversions: OpsConversionTotal[];
};

export type CreateBookingRequest = {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
};

export type DepositMethod = "auth_hold" | "card_on_file";

export type StayQuote = {
  nightly_rate_cents: number;
  nights: number;
  stay_subtotal_cents: number;
  network_fee_cents: number;
  guest_total_cents: number;
  deposit_cents: number;
};

/**
 * A price preview from POST /api/bookings/quote. `reserved` is always false:
 * nothing is held until a booking is created, and the quote returned by
 * creation is the one that governs the charge.
 */
export type StayQuoteResponse = {
  quote: StayQuote;
  networkFeeBps: number;
  depositMethod: DepositMethod;
  cancellationPolicy: CancellationPolicy;
  timezone: string;
  maxGuests: number;
  reserved: false;
};

export type CreateBookingResponse = {
  bookingId: string;
  quote: StayQuote;
  /** The rate that produced quote.network_fee_cents, for an honest label. */
  networkFeeBps: number;
  paymentClientSecret: string | null;
  setupClientSecret: string | null;
  depositMethod: DepositMethod;
  mockPayment: boolean;
  timezone: string;
  cancellationPolicy: CancellationPolicy;
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

export type MessageThread = {
  listingId: string;
  guestId: string;
  listingTitle: string;
  listingPhoto: string | null;
  counterpartName: string;
  lastBody: string;
  lastAt: string;
  unreadCount: number;
};

export type MessageItem = {
  id: string;
  listingId: string;
  bookingId: string | null;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  mine: boolean;
};

export type MessageThreadDetail = {
  listingId: string;
  guestId: string;
  listingTitle: string;
  listingPhoto: string | null;
  counterpartName: string;
  viewerIsHost: boolean;
  messages: MessageItem[];
};

export type UnreadCount = {
  unread: number;
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
  /**
   * An open card dispute on the booking. Every claim transition is frozen
   * while this is true — the SECURITY DEFINER functions refuse — so the page
   * explains it instead of offering an action that would silently fail.
   */
  chargebackOpen: boolean;
  canRespond: boolean;
  canResolve: boolean;
  canFileEvidence: boolean;
};

export type ReviewDirection = "guest_reviews_host" | "host_reviews_guest";

export type TrustStats = {
  profileId: string;
  staysCompleted: number;
  damageFreeStreak: number;
  avgRatingAsGuest: number | null;
  avgRatingAsHost: number | null;
  reviewCount: number;
  responseRate: number | null;
  hostCancellations: number;
  verificationTier: number;
  memberSince: string;
};

export type PublishedReview = {
  id: string;
  bookingId: string;
  authorId: string;
  subjectId: string;
  direction: ReviewDirection;
  rating: number;
  tags: string[];
  body: string;
  submittedAt: string;
  publishedAt: string;
  authorName: string;
  nights: number;
  city: string;
  checkOut: string;
  receipt: string;
};

export type Passport = {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  isHost: boolean;
  city: string | null;
  region: string | null;
  stats: TrustStats;
  reviews: PublishedReview[];
};

export type PassportExport = {
  payload: {
    avg_rating_as_guest: number | null;
    avg_rating_as_host: number | null;
    damage_free_streak: number;
    host_cancellations: number;
    member_since: string;
    profile_id: string;
    response_rate: number | null;
    review_count: number;
    stays_completed: number;
    verification_tier: number;
  };
  signature: string;
  alg: "Ed25519";
};

export type OwnReview = {
  id: string;
  rating: number;
  tags: string[];
  body: string;
  submittedAt: string;
  publishedAt: string | null;
};

export type ReviewForm = {
  bookingId: string;
  listingTitle: string;
  city: string;
  timezone: string;
  checkOut: string;
  nights: number;
  receipt: string;
  direction: ReviewDirection;
  viewerRole: "guest" | "host";
  stayCompleted: boolean;
  canSubmit: boolean;
  mine: OwnReview | null;
  published: PublishedReview[];
};

export const GUEST_REVIEW_TAGS = [
  "Spotless",
  "As photographed",
  "Easy check-in",
  "Quiet street",
  "Would return",
] as const;

export const HOST_REVIEW_TAGS = [
  "Left it tidy",
  "Communicative",
  "Respectful",
  "On-time checkout",
  "Would host again",
] as const;

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  open: "Open",
  guest_accepted: "Guest accepted",
  guest_disputed: "Disputed",
  arbitration: "In arbitration",
  resolved_host: "Resolved — host",
  resolved_guest: "Resolved — guest",
  resolved_split: "Resolved — split",
};
