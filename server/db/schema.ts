/**
 * Drizzle mirror of drizzle/*.sql. The SQL files are the source of truth —
 * migrations are append-only and hand-written because the availability lock is
 * a btree_gist exclusion constraint over a generated daterange, which the
 * Drizzle pg dialect cannot express.
 */
import { relations } from "drizzle-orm";
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
    index("bookings_payment_intent_idx").on(table.stripePaymentIntentId),
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
