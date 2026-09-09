/**
 * Host-side listing writes.
 *
 * RLS is what enforces ownership: listings_host_insert, listings_host_update
 * and listings_host_delete already restrict every verb to
 * host_id = app.current_user_id(), and listing_photos_host_write does the same
 * through the parent listing. The host_id filters here mirror those policies so
 * the intent reads locally; they are not what makes it safe. A host editing
 * another host's listing gets zero rows affected, not a leak.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingPhotos, listings } from "../db/schema";
import type {
  CancellationPolicy,
  ListingAmenities,
  ListingStatus,
  ListingType,
} from "../../src/lib/types";

export interface ListingInput {
  title: string;
  description?: string;
  type: ListingType;
  addressLine?: string;
  city: string;
  region?: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  timezone: string;
  nightlyRateCents: number;
  depositCents: number;
  maxGuests: number;
  amenities?: ListingAmenities;
  instantBook?: boolean;
  cancellationPolicy?: CancellationPolicy;
  status?: ListingStatus;
}

export interface HostListing {
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
  photos: { id: string; storagePath: string; sortOrder: number }[];
}

export async function listHostListings(tx: Tx, hostId: string): Promise<HostListing[]> {
  const rows = await tx.query.listings.findMany({
    where: eq(listings.hostId, hostId),
    with: { photos: { orderBy: asc(listingPhotos.sortOrder) } },
    orderBy: asc(listings.title),
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    city: row.city,
    country: row.country,
    timezone: row.timezone,
    nightlyRateCents: row.nightlyRateCents,
    depositCents: row.depositCents,
    maxGuests: row.maxGuests,
    status: row.status,
    cancellationPolicy: row.cancellationPolicy,
    instantBook: row.instantBook,
    photos: row.photos.map((p) => ({
      id: p.id,
      storagePath: p.storagePath,
      sortOrder: p.sortOrder,
    })),
  }));
}

export async function createListing(
  tx: Tx,
  hostId: string,
  input: ListingInput,
): Promise<string> {
  const [created] = await tx
    .insert(listings)
    .values({
      hostId,
      title: input.title,
      description: input.description ?? "",
      type: input.type,
      addressLine: input.addressLine ?? "",
      city: input.city,
      region: input.region ?? "",
      country: input.country,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      timezone: input.timezone,
      nightlyRateCents: input.nightlyRateCents,
      depositCents: input.depositCents,
      maxGuests: input.maxGuests,
      amenities: input.amenities ?? {},
      instantBook: input.instantBook ?? false,
      cancellationPolicy: input.cancellationPolicy ?? "moderate",
      // A new listing is a draft unless the host says otherwise, so a
      // half-filled one is never publicly bookable.
      status: input.status ?? "draft",
    })
    .returning({ id: listings.id });
  if (!created) throw new Error("Could not create the listing");
  return created.id;
}

export async function updateListing(
  tx: Tx,
  hostId: string,
  listingId: string,
  patch: Partial<ListingInput>,
): Promise<boolean> {
  const updated = await tx
    .update(listings)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.addressLine !== undefined ? { addressLine: patch.addressLine } : {}),
      ...(patch.city !== undefined ? { city: patch.city } : {}),
      ...(patch.region !== undefined ? { region: patch.region } : {}),
      ...(patch.country !== undefined ? { country: patch.country } : {}),
      ...(patch.lat !== undefined ? { lat: patch.lat } : {}),
      ...(patch.lng !== undefined ? { lng: patch.lng } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.nightlyRateCents !== undefined
        ? { nightlyRateCents: patch.nightlyRateCents }
        : {}),
      ...(patch.depositCents !== undefined ? { depositCents: patch.depositCents } : {}),
      ...(patch.maxGuests !== undefined ? { maxGuests: patch.maxGuests } : {}),
      ...(patch.amenities !== undefined ? { amenities: patch.amenities } : {}),
      ...(patch.instantBook !== undefined ? { instantBook: patch.instantBook } : {}),
      ...(patch.cancellationPolicy !== undefined
        ? { cancellationPolicy: patch.cancellationPolicy }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(and(eq(listings.id, listingId), eq(listings.hostId, hostId)))
    .returning({ id: listings.id });
  return updated.length > 0;
}

/**
 * Deleting a listing with bookings against it is refused by the foreign key
 * (bookings.listing_id is ON DELETE RESTRICT), which is the right answer: a
 * stay someone paid for should not vanish because a host tidied up. Pausing
 * is the way to take a listing off the market.
 */
export async function deleteListing(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<boolean> {
  const deleted = await tx
    .delete(listings)
    .where(and(eq(listings.id, listingId), eq(listings.hostId, hostId)))
    .returning({ id: listings.id });
  return deleted.length > 0;
}

export async function addListingPhoto(
  tx: Tx,
  listingId: string,
  storagePath: string,
): Promise<string> {
  const [created] = await tx
    .insert(listingPhotos)
    .values({
      listingId,
      storagePath,
      // Append: one past the current highest, so uploads keep their order.
      sortOrder: sql`(
        SELECT COALESCE(MAX(p.sort_order) + 1, 0)
          FROM ${listingPhotos} p WHERE p.listing_id = ${listingId}::uuid
      )`,
    })
    .returning({ id: listingPhotos.id });
  if (!created) throw new Error("Could not attach the photo");
  return created.id;
}

export async function deleteListingPhoto(tx: Tx, photoId: string): Promise<boolean> {
  const deleted = await tx
    .delete(listingPhotos)
    .where(eq(listingPhotos.id, photoId))
    .returning({ id: listingPhotos.id });
  return deleted.length > 0;
}

/** Whether this member owns the listing — used before signing an upload URL. */
export async function hostOwnsListing(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.hostId, hostId)))
    .limit(1);
  return rows.length > 0;
}
