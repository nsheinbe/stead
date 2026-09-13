/**
 * Slice 1 seed: 1 host, 6 active listings across timezones, picsum photos,
 * varied policies. Idempotent — re-running it leaves the same rows.
 *
 *   DATABASE_URL_OWNER=... npm run db:seed
 *
 * Local and staging only. Production Explore hides these ids even if the
 * rows exist; this script also refuses a production target unless you set
 * ALLOW_DEMO_LISTINGS=1. Do not seed openstead.app.
 *
 * Runs as the owner, which bypasses RLS. app_user could not write a listing for
 * a host it is not, which is the point of the policies.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../server/db/client";
import { listingBlackouts, listingPhotos, listings, profiles, users } from "../server/db/schema";
import {
  assertDemoSeedAllowed,
  SEED_HOST_EMAIL,
  SEED_HOST_ID,
  SEED_LISTING_IDS,
} from "../server/lib/seedInventory";
import type { ListingAmenities } from "../src/lib/types";

const HOST_ID = SEED_HOST_ID;
const HOST_EMAIL = SEED_HOST_EMAIL;

type SeedListing = {
  id: string;
  title: string;
  description: string;
  type: "entire_home" | "apartment" | "private_room";
  addressLine: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  timezone: string;
  nightlyRateCents: number;
  depositCents: number;
  maxGuests: number;
  amenities: ListingAmenities;
  instantBook: boolean;
  cancellationPolicy: "flexible" | "moderate" | "strict";
  photos: string[];
};

const SEED_LISTINGS: SeedListing[] = [
  {
    id: SEED_LISTING_IDS[0],
    title: "Gable End Cottage",
    description:
      "A lived-in Hudson Valley cottage. Cedar, a working fireplace, and a kitchen that actually gets used. Check-in is 4 PM listing time; checkout 11 AM. The deposit sits in neutral escrow — it is not ours and it is not Nora's.",
    type: "entire_home",
    addressLine: "14 Gable Lane",
    city: "Hudson",
    region: "NY",
    country: "US",
    lat: 42.2529,
    lng: -73.7909,
    timezone: "America/New_York",
    nightlyRateCents: 20000,
    depositCents: 30000,
    maxGuests: 4,
    amenities: { bedrooms: 2, beds: 2, wifi: true, kitchen: true, fireplace: true },
    instantBook: true,
    cancellationPolicy: "flexible",
    photos: ["stead-gable-1", "stead-gable-2", "stead-gable-3"],
  },
  {
    id: SEED_LISTING_IDS[1],
    title: "Warm brick loft",
    description:
      "A one-bedroom loft on a quiet side street in Montréal. Brick, tall windows, and a kitchen you can cook in. Hosts list here because they keep more — a flat 2% network fee, paid at check-in.",
    type: "apartment",
    addressLine: "88 Rue Saint-Viateur",
    city: "Montréal",
    region: "QC",
    country: "CA",
    lat: 45.5242,
    lng: -73.5982,
    timezone: "America/Toronto",
    nightlyRateCents: 14600,
    depositCents: 25000,
    maxGuests: 2,
    amenities: { bedrooms: 1, beds: 1, wifi: true, kitchen: true },
    instantBook: false,
    cancellationPolicy: "moderate",
    photos: ["stead-loft-1", "stead-loft-2"],
  },
  {
    id: SEED_LISTING_IDS[2],
    title: "Lemon-tree courtyard",
    description:
      "A small house around a courtyard lemon tree in Lisbon. Light all afternoon. Strict cancellation, because the calendar is the point.",
    type: "entire_home",
    addressLine: "12 Travessa das Mercês",
    city: "Lisbon",
    region: "Lisboa",
    country: "PT",
    lat: 38.7139,
    lng: -9.1446,
    timezone: "Europe/Lisbon",
    nightlyRateCents: 17800,
    depositCents: 28000,
    maxGuests: 3,
    amenities: { bedrooms: 2, beds: 2, wifi: true, kitchen: true, courtyard: true },
    instantBook: true,
    cancellationPolicy: "strict",
    photos: ["stead-lemon-1", "stead-lemon-2"],
  },
  {
    id: SEED_LISTING_IDS[3],
    title: "Cedar A-frame",
    description:
      "An A-frame in the firs outside Portland. Instant book. Flexible cancel. The 2% is the whole take — hosts list because they make more.",
    type: "entire_home",
    addressLine: "901 Fir Crest Road",
    city: "Portland",
    region: "OR",
    country: "US",
    lat: 45.5152,
    lng: -122.6784,
    timezone: "America/Los_Angeles",
    nightlyRateCents: 22500,
    depositCents: 35000,
    maxGuests: 5,
    amenities: { bedrooms: 3, beds: 3, wifi: true, kitchen: true, fireplace: true },
    instantBook: true,
    cancellationPolicy: "flexible",
    photos: ["stead-aframe-1", "stead-aframe-2"],
  },
  {
    id: SEED_LISTING_IDS[4],
    title: "Canal house room",
    description:
      "A private room on a canal. Moderate policy. Breakfast is downstairs if you want it; the lock on the room is yours.",
    type: "private_room",
    addressLine: "42 Prinsengracht",
    city: "Amsterdam",
    region: "North Holland",
    country: "NL",
    lat: 52.3738,
    lng: 4.891,
    timezone: "Europe/Amsterdam",
    nightlyRateCents: 11900,
    depositCents: 15000,
    maxGuests: 2,
    amenities: { bedrooms: 1, beds: 1, wifi: true },
    instantBook: false,
    cancellationPolicy: "moderate",
    photos: ["stead-canal-1"],
  },
  {
    id: SEED_LISTING_IDS[5],
    title: "Lantern loft",
    description:
      "A timber loft in Kyoto. Strict dates, quiet street, futons that are actually comfortable. Instant payout to the host at listing-local check-in.",
    type: "apartment",
    addressLine: "3-2 Gionmachi",
    city: "Kyoto",
    region: "Kyoto",
    country: "JP",
    lat: 35.0036,
    lng: 135.77,
    timezone: "Asia/Tokyo",
    nightlyRateCents: 18900,
    depositCents: 30000,
    maxGuests: 3,
    amenities: { bedrooms: 1, beds: 2, wifi: true, kitchen: true },
    instantBook: false,
    cancellationPolicy: "strict",
    photos: ["stead-lantern-1", "stead-lantern-2"],
  },
];

export async function seed(db: Db): Promise<void> {
  assertDemoSeedAllowed();
  // The trigger on public.users creates the profile row.
  await db
    .insert(users)
    .values({ id: HOST_ID, name: "Nora", email: HOST_EMAIL, emailVerified: new Date() })
    .onConflictDoNothing({ target: users.id });

  const testConnect = process.env.STRIPE_TEST_CONNECT_ACCOUNT_ID?.trim();
  await db
    .update(profiles)
    .set({
      isHost: true,
      displayName: "Nora",
      // Optional test Connect account (acct_...). Leave unset so seed does not
      // invent a fake id; live Stripe bookings then fail closed instead of
      // charging the platform. Never commit a secret key.
      ...(testConnect && /^acct_[A-Za-z0-9_]+$/.test(testConnect)
        ? { stripeConnectAccountId: testConnect }
        : {}),
    })
    .where(sql`${profiles.id} = ${HOST_ID}::uuid`);

  for (const l of SEED_LISTINGS) {
    await db
      .insert(listings)
      .values({
        id: l.id,
        hostId: HOST_ID,
        title: l.title,
        description: l.description,
        type: l.type,
        addressLine: l.addressLine,
        city: l.city,
        region: l.region,
        country: l.country,
        lat: l.lat,
        lng: l.lng,
        timezone: l.timezone,
        nightlyRateCents: l.nightlyRateCents,
        depositCents: l.depositCents,
        maxGuests: l.maxGuests,
        amenities: l.amenities,
        instantBook: l.instantBook,
        cancellationPolicy: l.cancellationPolicy,
        status: "active",
      })
      .onConflictDoNothing({ target: listings.id });

    for (const [sortOrder, seedName] of l.photos.entries()) {
      const storagePath = `https://picsum.photos/seed/${seedName}/1200/800`;
      const existing = await db.query.listingPhotos.findFirst({
        where: sql`${listingPhotos.listingId} = ${l.id}::uuid AND ${listingPhotos.storagePath} = ${storagePath}`,
      });
      if (!existing) {
        await db.insert(listingPhotos).values({ listingId: l.id, storagePath, sortOrder });
      }
    }
  }

  const blackout = await db.query.listingBlackouts.findFirst({
    where: sql`${listingBlackouts.listingId} = ${SEED_LISTINGS[0]!.id}::uuid`,
  });
  if (!blackout) {
    await db.insert(listingBlackouts).values({
      listingId: SEED_LISTINGS[0]!.id,
      startDate: "2026-12-20",
      endDate: "2026-12-27",
    });
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      "DATABASE_URL_OWNER is required — the table owner on the direct (non-pooled) host. " +
        "Never commit it; export it in your shell.",
    );
    process.exit(1);
  }
  try {
    assertDemoSeedAllowed();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  await seed(createDb(url));
  console.log(
    `seeded ${SEED_LISTINGS.length} active listings for one host (local/staging demo inventory)`,
  );
  process.exit(0);
}
