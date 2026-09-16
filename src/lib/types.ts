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
  /**
   * The street address the editor promises is "shared with a guest after a
   * stay is confirmed, not on the public page". Present only when the viewer
   * owns the listing; absent on every other read, so the browser type says so.
   */
  addressLine?: string;
  status: ListingStatus;
  host: HostSummary | null;
  /**
   * HM-05: present only when this listing has a verified walkthrough a guest
   * may see, or when its own host is previewing. Null means there is nothing
   * to walk — there is no "coming soon" for guests.
   */
  honesty?: ListingHonesty | null;
  /**
   * HM-01: the front-door point and whether the host confirmed it. Present
   * only when the viewer owns the listing; never on a public read.
   */
  coordinates?: ListingCoordinates | null;
  /**
   * HM-06: the map pin and what the host filmed outside, at the precision
   * this viewer is entitled to. Null when there is nothing true to show —
   * no confirmed point and no approach footage.
   */
  street?: ListingStreet | null;
  /**
   * HM-06: the host's own setting, for the editor to render. Present only
   * when the viewer owns the listing — what a guest needs is already decided
   * for them in `street`.
   */
  approachVisibility?: ApproachVisibility;
};

/**
 * HM-06 — who may see the front door: the exact pin and the host's approach
 * footage. The default keeps the same promise the editor's address hint makes
 * (DECISIONS D09); a host may open it to everyone, and a guest with a
 * confirmed stay is entitled either way.
 */
export type ApproachVisibility = "confirmed_stay" | "everyone";

/**
 * HM-06: where the home is, as this viewer is allowed to know it.
 *
 * `pin` is already rounded by the server when `exact` is false — the browser
 * never receives the front door and rounds it for display, because a value
 * that reached the client has left. `hasApproach` without a `posterUrl` is
 * the honest "the host filmed this, but not for you yet".
 */
export type ListingStreet = {
  pin: { lat: number; lng: number } | null;
  /** Metres of rounding applied. 0 when the pin is the front door itself. */
  precisionM: number;
  exact: boolean;
  hasApproach: boolean;
  /** A frame from the host's approach, signed and short-lived. */
  posterUrl: string | null;
  ownerPreview: boolean;
};

/** Whether the walk covers the whole rental or only the part the host kept. */
export type HonestyCoverage = "whole_home" | "rental_area";

/** HM-05: the honesty facts the listing-detail entry needs. No object keys. */
export type ListingHonesty = {
  capturedOn: string | null;
  verifiedAt: string | null;
  coverage: HonestyCoverage;
  policyVersion: number;
  /** True when the viewer is the host looking at their own unpublished home. */
  ownerPreview: boolean;
  /** A real captured frame, signed and short-lived. Null when none was saved. */
  posterUrl: string | null;
};

/** GET /api/listings/:id/walkthrough — everything the walk route loads. */
export type Walkthrough = ListingHonesty & {
  listingId: string;
  title: string;
  timezone: string;
  /** Short-lived signed URL for the artifact the viewer loads; compressed when there is one. */
  splatUrl: string;
  /** Real frames from the host's walk, for reduced motion and for no WebGL. */
  stills: { index: number; url: string }[];
  expiresInSeconds: number;
};

export type ListingCoordinates = {
  lat: number;
  lng: number;
  /** ISO timestamp of the host's recorded confirmation, or null. */
  confirmedAt: string | null;
};

/** HM-01: honesty-scan state machine, mirrored from public.scan_state. */
export type ScanState =
  | "capturing"
  | "uploaded"
  | "reconstructing"
  | "needs_mask"
  | "verified"
  | "rejected"
  | "failed";

/** Locked reason keys a rejected / failed scan carries. Sentences live in honestyCopy. */
export type ScanReason =
  | "too_few_samples"
  | "location_mismatch"
  | "walk_too_short"
  | "walk_too_long"
  | "reconstruction_failed";

/** DECISIONS D07: the thresholds a walk is judged against. Integer metres and seconds. */
export type ScanThresholds = {
  accuracyMaxM: number;
  geofenceRadiusM: number;
  bookendWindowSeconds: number;
  bookendMinSamples: number;
  minIndoorSeconds: number;
  maxSeconds: number;
};

/** HM-02: what the server measured at completion, as stored on the scan row. */
export type GeofenceStatsJson = {
  sampleCount: number;
  accurateCount: number;
  durationSeconds: number;
  startAccurate: number;
  endAccurate: number;
  medianDistanceM: number | null;
  startDistanceM: number | null;
  endDistanceM: number | null;
};

/** The three objects a walk uploads. Later kinds are the worker's (HM-03+). */
export type ScanUploadKind = "video" | "attestation" | "notes";

/** Which of the package's parts the server has recorded. */
export type ScanUploads = Record<ScanUploadKind, boolean>;

/** One walk-scan as its host sees it. State and reason are the server's. */
export type ListingScan = {
  id: string;
  state: ScanState;
  reason: ScanReason | null;
  policyVersion: number;
  thresholds: ScanThresholds;
  capturedOn: string | null;
  verifiedAt: string | null;
  createdAt: string;
  /** HM-02: recorded at completion; all false while capturing. */
  uploads: ScanUploads;
  stats: GeofenceStatsJson | null;
  completedAt: string | null;
  /** HM-03: reconstruction attempts so far, the cap, and whether the host may ask again. */
  attempt: number;
  maxAttempts: number;
  canRetry: boolean;
  claimedAt: string | null;
  updatedAt: string;
  /** HM-03: which worker outputs exist. */
  outputs: Record<ScanWorkerArtifactKind, boolean>;
  /** HM-04: which pipeline the scan is queued for, and what the host has marked. */
  job: ScanJobKind;
  mask: ScanMask | null;
  /** Whether this listing type may answer "the whole walk is the rental" (D11). */
  wholeHomeAllowed: boolean;
};

/** What the worker may record (HM-03). The raw kinds are recorded at upload. */
export type ScanWorkerArtifactKind = "frames" | "cameras" | "splat" | "splat_compressed" | "stills";

/** HM-04: the two kinds of work the same worker does on a scan. */
export type ScanJobKind = "reconstruct" | "crop";

/** One private stretch of the walk, in milliseconds on the recording clock. */
export type MaskSegment = { fromMs: number; toMs: number };

/** HM-04: the host's answer to "what may guests walk through?". */
export type ScanMask = {
  segments: MaskSegment[];
  wholeHomeConfirmedAt: string | null;
  updatedAt: string;
};

/** POST /api/listings/:id/scans/:scanId/mask */
export type ScanMaskInput =
  | { wholeHomeConfirmed: true }
  | { wholeHomeConfirmed?: false; segments: MaskSegment[] };

/** GET /api/listings/:id/scans/:scanId/stills — short-lived signed URLs to real frames. */
export type ScanStills = {
  /** `atMs` is where the frame sits on the recording clock (HM-04's scrubber). */
  stills: { index: number; url: string; atMs: number }[];
  expiresInSeconds: number;
  durationMs: number;
};

/** A claimed reconstruction job as the worker sees it (POST /api/scan-worker/jobs/claim). */
export type ScanJob = {
  scanId: string;
  listingId: string;
  /** HM-04: `reconstruct` builds the walkthrough, `crop` rebuilds it without the host's private frames. */
  job: ScanJobKind;
  attempt: number;
  timezone: string;
  target: { lat: number; lng: number };
  thresholds: { accuracyMaxM: number; geofenceRadiusM: number };
  inputs: { videoKey: string; videoContentType: string; attestationKey: string; notesKey: string };
  /** Ranges the worker must drop before it trains. Empty for a reconstruct job. */
  maskSegments: MaskSegment[];
  /** How long the walk ran, so the worker can place a frame on the host's clock. */
  durationMs: number;
  /** Where the worker writes its outputs. */
  outputPrefix: string;
};

export type ScanJobArtifact = {
  kind: ScanWorkerArtifactKind;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
};

/** POST /api/scan-worker/jobs/:scanId/finish */
export type ScanJobFinish =
  | { attempt: number; outcome: "needs_mask"; artifacts: ScanJobArtifact[] }
  | { attempt: number; outcome: "verified"; artifacts: ScanJobArtifact[] }
  | { attempt: number; outcome: "failed"; reason: "reconstruction_failed"; artifacts: ScanJobArtifact[] };

/** POST /api/listings/:id/scans/:scanId/uploads — where one part of the package goes. */
export type ScanUploadTarget =
  | {
      kind: "video";
      key: string;
      uploadId: string;
      partSizeBytes: number;
      maxParts: number;
      maxBytes: number;
    }
  | {
      kind: "attestation" | "notes";
      key: string;
      uploadUrl: string;
      expiresInSeconds: number;
      maxBytes: number;
    };

export type ScanUploadedPart = { partNumber: number; sizeBytes: number };

/**
 * The location record the phone uploads. Samples and clocks only — never a
 * verdict. The server judges it; anything else in the JSON is dropped.
 */
export type ScanAttestation = {
  version: 1;
  scanId: string;
  listingId: string;
  policyVersion: number;
  recording: { startedAt: string; durationMs: number; mimeType: string };
  samples: { t: number; lat: number; lng: number; acc: number }[];
  pauses: { fromMs: number; toMs: number }[];
  client: { userAgent: string; platform: string | null };
};

/** GET /api/listings/:id/scan — owner only. */
export type ListingScanStatus = {
  listingId: string;
  coordinatesConfirmed: boolean;
  storageConfigured: boolean;
  /** Current config, for the on-device progress meter. The row's snapshot is what is judged. */
  thresholds: ScanThresholds;
  policyVersion: number;
  scan: ListingScan | null;
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
  /**
   * The trips *list* carries `TripListing` as it stands; only the detail adds
   * the street address, and `getTripForParty` only sets it once the stay is
   * confirmed (see `stayIsConfirmed`). The list type cannot express it at all,
   * which is the point: a pending or canceled stay has no address to leak.
   */
  listing: TripListing & { addressLine?: string };
};

/** Fee policy from app_config. Public: the 2% is the whole point. */
export type PublicConfig = {
  networkFeeBps: number;
  checkinLocalTime: string;
  checkoutLocalTime: string;
  claimWindowHours: number;
  pendingPaymentTtlMinutes: number;
  /** False until Nick sets ALLOW_GUEST_BOOKINGS=1. Create-booking refuses when off. */
  guestBookingsOpen: boolean;
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
  /** Decimal degrees. The server already validates ranges; HM-01 adds the browser side. */
  lat?: number | null;
  lng?: number | null;
  /** HM-01: record "this is the front door". Refused without both lat and lng. */
  confirmCoordinates?: boolean;
  /** HM-06: who may see the exact pin and the approach footage. */
  approachVisibility?: ApproachVisibility;
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
