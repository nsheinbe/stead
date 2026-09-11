/**
 * Drizzle mirror of drizzle/*.sql. The SQL files are the source of truth —
 * migrations are append-only and hand-written because the availability lock is
 * a btree_gist exclusion constraint over a generated daterange, which the
 * Drizzle pg dialect cannot express.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ListingAmenities } from "../../src/lib/types";

export const listingType = pgEnum("listing_type", ["entire_home", "apartment", "private_room"]);
export const cancellationPolicy = pgEnum("cancellation_policy", ["flexible", "moderate", "strict"]);
export const listingStatus = pgEnum("listing_status", ["draft", "active", "paused"]);
export const bookingStatus = pgEnum("booking_status", [
  "pending_payment",
  "confirmed",
  "checked_in",
  "completed",
  "canceled_by_guest",
  "canceled_by_host",
  "expired",
]);
export const escrowState = pgEnum("escrow_state", [
  "scheduled",
  "held",
  "claim_window",
  "released",
  "claimed",
  "disputed",
  "arbitrated",
]);
export const escrowMethod = pgEnum("escrow_method", ["auth_hold", "card_on_file"]);
export const payoutState = pgEnum("payout_state", ["scheduled", "paid", "frozen", "failed"]);
export const refundReason = pgEnum("refund_reason", [
  "guest_cancel",
  "host_cancel",
  "dispute",
  // Payment settled after the TTL had already expired the booking.
  "expired",
]);
export const claimState = pgEnum("claim_state", [
  "open",
  "guest_accepted",
  "guest_disputed",
  "arbitration",
  "resolved_host",
  "resolved_guest",
  "resolved_split",
]);
export const reviewDirection = pgEnum("review_direction", ["guest_reviews_host", "host_reviews_guest"]);

// --- Identity: written by Auth.js through the Drizzle adapter -----------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// --- Marketplace --------------------------------------------------------------

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  isHost: boolean("is_host").notNull().default(false),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  idVerified: boolean("id_verified").notNull().default(false),
  memberSince: timestamp("member_since", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  /** Stripe Connect Express/Standard account. Required for live charges; host is MOR. */
  stripeConnectAccountId: text("stripe_connect_account_id"),
  /** Snapshot from account.updated / live retrieve. Members cannot write these. */
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  stripePayoutsEnabled: boolean("stripe_payouts_enabled").notNull().default(false),
  stripeDetailsSubmitted: boolean("stripe_details_submitted").notNull().default(false),
  /** Independent arbitration. Platform-set; members cannot write this column. */
  isArbiter: boolean("is_arbiter").notNull().default(false),
  /** Ops console. Platform-set; members cannot write this column. */
  isOps: boolean("is_ops").notNull().default(false),
  /** Latest Stripe Identity VerificationSession id. */
  stripeIdentitySessionId: text("stripe_identity_session_id"),
});

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    type: listingType("type").notNull(),
    addressLine: text("address_line").notNull().default(""),
    city: text("city").notNull(),
    region: text("region").notNull().default(""),
    country: text("country").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    timezone: text("timezone").notNull(),
    nightlyRateCents: integer("nightly_rate_cents").notNull(),
    depositCents: integer("deposit_cents").notNull(),
    maxGuests: integer("max_guests").notNull(),
    amenities: jsonb("amenities").$type<ListingAmenities>().notNull().default({}),
    instantBook: boolean("instant_book").notNull().default(false),
    cancellationPolicy: cancellationPolicy("cancellation_policy").notNull().default("moderate"),
    status: listingStatus("status").notNull().default("draft"),
    /** Unused at launch — nullable, never required for booking. */
    permitNumber: text("permit_number"),
  },
  (table) => [index("listings_status_idx").on(table.status)],
);

export const listingPhotos = pgTable(
  "listing_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("listing_photos_listing_idx").on(table.listingId)],
);

export const listingBlackouts = pgTable(
  "listing_blackouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (table) => [index("listing_blackouts_listing_idx").on(table.listingId)],
);

/** `stay` (generated daterange) and bookings_no_overlap live in SQL only. */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "restrict" }),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    guests: integer("guests").notNull(),
    nights: integer("nights").notNull(),
    nightlyRateCents: integer("nightly_rate_cents").notNull(),
    staySubtotalCents: integer("stay_subtotal_cents").notNull(),
    networkFeeCents: integer("network_fee_cents").notNull(),
    // The rate that produced network_fee_cents. Snapshotted so a historical
    // receipt can label itself without reading today's config (0012).
    networkFeeBps: integer("network_fee_bps").notNull(),
    guestTotalCents: integer("guest_total_cents").notNull(),
    depositCents: integer("deposit_cents").notNull(),
    cancellationPolicy: cancellationPolicy("cancellation_policy").notNull(),
    status: bookingStatus("status").notNull().default("pending_payment"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bookings_guest_idx").on(table.guestId),
    index("bookings_listing_idx").on(table.listingId),
    // Unique so one payment can only ever confirm one booking; partial
    // because the id is null between insert and intent creation.
    uniqueIndex("bookings_payment_intent_key")
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} IS NOT NULL`),
  ],
);

export const escrowDeposits = pgTable("escrow_deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  state: escrowState("state").notNull().default("scheduled"),
  method: escrowMethod("method").notNull(),
  stripeSetupIntentId: text("stripe_setup_intent_id"),
  stripeAuthPiId: text("stripe_auth_pi_id"),
  heldAt: timestamp("held_at", { mode: "date", withTimezone: true }),
  windowClosesAt: timestamp("window_closes_at", { mode: "date", withTimezone: true }),
  releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
  resolvedAmountCents: integer("resolved_amount_cents"),
});

export const escrowAudit = pgTable(
  "escrow_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    depositId: uuid("deposit_id")
      .notNull()
      .references(() => escrowDeposits.id, { onDelete: "cascade" }),
    fromState: escrowState("from_state"),
    toState: escrowState("to_state").notNull(),
    actor: text("actor").notNull(),
    at: timestamp("at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta").notNull().default({}),
  },
  (table) => [index("escrow_audit_deposit_idx").on(table.depositId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: refundReason("reason").notNull(),
    stripeRefundId: text("stripe_refund_id").unique(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("refunds_booking_idx").on(table.bookingId)],
);

export const refundsRelations = relations(refunds, ({ one }) => ({
  booking: one(bookings, { fields: [refunds.bookingId], references: [bookings.id] }),
}));

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // One per booking; the uniqueness is what makes a redelivered webhook safe.
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    stripeTransferId: text("stripe_transfer_id").unique(),
    state: payoutState("state").notNull().default("scheduled"),
    paidAt: timestamp("paid_at", { mode: "date", withTimezone: true }),
  },
  (table) => [index("payouts_host_idx").on(table.hostId)],
);

export const payoutsRelations = relations(payouts, ({ one }) => ({
  booking: one(bookings, { fields: [payouts.bookingId], references: [bookings.id] }),
  host: one(profiles, { fields: [payouts.hostId], references: [profiles.id] }),
}));

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    filedBy: uuid("filed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    state: claimState("state").notNull().default("open"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    resolutionAmountCents: integer("resolution_amount_cents"),
    resolutionNote: text("resolution_note"),
  },
  (table) => [index("claims_filed_by_idx").on(table.filedBy), index("claims_state_idx").on(table.state)],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    storagePath: text("storage_path").notNull(),
    note: text("note"),
  },
  (table) => [index("claim_evidence_claim_idx").on(table.claimId)],
);

export const claimsRelations = relations(claims, ({ one, many }) => ({
  booking: one(bookings, { fields: [claims.bookingId], references: [bookings.id] }),
  filer: one(profiles, { fields: [claims.filedBy], references: [profiles.id] }),
  evidence: many(claimEvidence),
}));

export const claimEvidenceRelations = relations(claimEvidence, ({ one }) => ({
  claim: one(claims, { fields: [claimEvidence.claimId], references: [claims.id] }),
  uploader: one(profiles, { fields: [claimEvidence.uploadedBy], references: [profiles.id] }),
}));

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    direction: reviewDirection("direction").notNull(),
    rating: integer("rating").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    body: text("body").notNull().default(""),
    submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("reviews_booking_direction_key").on(table.bookingId, table.direction),
    index("reviews_subject_idx").on(table.subjectId),
    index("reviews_author_idx").on(table.authorId),
  ],
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  booking: one(bookings, { fields: [reviews.bookingId], references: [bookings.id] }),
  author: one(profiles, { fields: [reviews.authorId], references: [profiles.id], relationName: "reviewAuthor" }),
  subject: one(profiles, { fields: [reviews.subjectId], references: [profiles.id], relationName: "reviewSubject" }),
}));

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
  },
  (table) => [index("messages_thread_idx").on(table.listingId, table.createdAt)],
);

export const messagesRelations = relations(messages, ({ one }) => ({
  listing: one(listings, { fields: [messages.listingId], references: [listings.id] }),
  booking: one(bookings, { fields: [messages.bookingId], references: [bookings.id] }),
  sender: one(profiles, { fields: [messages.senderId], references: [profiles.id], relationName: "messageSender" }),
  recipient: one(profiles, {
    fields: [messages.recipientId],
    references: [profiles.id],
    relationName: "messageRecipient",
  }),
}));

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const cronHeartbeats = pgTable("cron_heartbeats", {
  job: text("job").primaryKey(),
  lastOk: timestamp("last_ok", { mode: "date", withTimezone: true }),
  lastError: text("last_error"),
});

export const stripeDisputes = pgTable(
  "stripe_disputes",
  {
    id: text("id").primaryKey(),
    paymentIntentId: text("payment_intent_id"),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { mode: "date", withTimezone: true }),
  },
  (table) => [index("stripe_disputes_booking_idx").on(table.bookingId)],
);

export const reviewReminders = pgTable(
  "review_reminders",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.bookingId, table.recipientId, table.kind] })],
);

// --- Relations ----------------------------------------------------------------

export const listingsRelations = relations(listings, ({ one, many }) => ({
  host: one(profiles, { fields: [listings.hostId], references: [profiles.id] }),
  photos: many(listingPhotos),
  blackouts: many(listingBlackouts),
  bookings: many(bookings),
}));

export const listingPhotosRelations = relations(listingPhotos, ({ one }) => ({
  listing: one(listings, { fields: [listingPhotos.listingId], references: [listings.id] }),
}));

export const listingBlackoutsRelations = relations(listingBlackouts, ({ one }) => ({
  listing: one(listings, { fields: [listingBlackouts.listingId], references: [listings.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  listing: one(listings, { fields: [bookings.listingId], references: [listings.id] }),
  guest: one(profiles, { fields: [bookings.guestId], references: [profiles.id] }),
  escrow: one(escrowDeposits, { fields: [bookings.id], references: [escrowDeposits.bookingId] }),
}));

export const escrowDepositsRelations = relations(escrowDeposits, ({ one, many }) => ({
  booking: one(bookings, { fields: [escrowDeposits.bookingId], references: [bookings.id] }),
  audit: many(escrowAudit),
}));

export const escrowAuditRelations = relations(escrowAudit, ({ one }) => ({
  deposit: one(escrowDeposits, { fields: [escrowAudit.depositId], references: [escrowDeposits.id] }),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  user: one(users, { fields: [profiles.id], references: [users.id] }),
  listings: many(listings),
  bookings: many(bookings),
}));
