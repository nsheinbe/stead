/**
 * Read paths for listings and fee policy.
 *
 * The `visible` predicate below mirrors the listings_read_active policy rather
 * than replacing it. The policy is the enforcement; repeating it here keeps the
 * query's intent readable and lets a 404 be a 404 instead of an empty row set.
 */
import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Tx } from "../db/client";
import { appConfig, listingPhotos, listings } from "../db/schema";
import type {
  ListingDetail,
  ListingPhoto,
  ListingSummary,
  PublicConfig,
} from "../../src/lib/types";

function toPhotos(rows: { id: string; storagePath: string; sortOrder: number }[]): ListingPhoto[] {
  return rows.map((p) => ({ id: p.id, storagePath: p.storagePath, sortOrder: p.sortOrder }));
}

export async function listActiveListings(tx: Tx): Promise<ListingSummary[]> {
  const rows = await tx.query.listings.findMany({
    where: eq(listings.status, "active"),
    orderBy: desc(listings.nightlyRateCents),
    with: { photos: { orderBy: asc(listingPhotos.sortOrder) } },
  });

  return rows.map((l) => ({
    id: l.id,
    title: l.title,
    type: l.type,
    city: l.city,
    region: l.region,
    country: l.country,
    timezone: l.timezone,
    nightlyRateCents: l.nightlyRateCents,
    depositCents: l.depositCents,
    maxGuests: l.maxGuests,
    amenities: l.amenities,
    instantBook: l.instantBook,
    cancellationPolicy: l.cancellationPolicy,
    photos: toPhotos(l.photos),
  }));
}

/** Active listings are public; a host may also open their own draft or paused rows. */
export async function getListingForViewer(
  tx: Tx,
  listingId: string,
  viewerId: string | null,
): Promise<ListingDetail | null> {
  const visible = viewerId
    ? or(eq(listings.status, "active"), eq(listings.hostId, viewerId))
    : eq(listings.status, "active");

  const row = await tx.query.listings.findFirst({
    where: and(eq(listings.id, listingId), visible),
    with: {
      photos: { orderBy: asc(listingPhotos.sortOrder) },
      host: { columns: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    city: row.city,
    region: row.region,
    country: row.country,
    timezone: row.timezone,
    nightlyRateCents: row.nightlyRateCents,
    depositCents: row.depositCents,
    maxGuests: row.maxGuests,
    amenities: row.amenities,
    instantBook: row.instantBook,
    cancellationPolicy: row.cancellationPolicy,
    photos: toPhotos(row.photos),
    description: row.description,
    addressLine: row.addressLine,
    status: row.status,
    host: row.host
      ? { id: row.host.id, displayName: row.host.displayName, avatarUrl: row.host.avatarUrl }
      : null,
  };
}

function intFromConfig(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return fallback;
}

function stringFromConfig(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export async function getConfigMap(tx: Tx): Promise<Record<string, unknown>> {
  const rows = await tx.select().from(appConfig);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function toPublicConfig(map: Record<string, unknown>): PublicConfig {
  return {
    networkFeeBps: intFromConfig(map.network_fee_bps, 200),
    checkinLocalTime: stringFromConfig(map.checkin_local_time, "16:00"),
    checkoutLocalTime: stringFromConfig(map.checkout_local_time, "11:00"),
    claimWindowHours: intFromConfig(map.claim_window_hours, 48),
    pendingPaymentTtlMinutes: intFromConfig(map.pending_payment_ttl_minutes, 30),
  };
}

export { intFromConfig };
