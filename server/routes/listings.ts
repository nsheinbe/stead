import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { listings } from "../db/schema";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { parseListingFilters } from "../../src/lib/filters";
import { HONESTY_REFUSALS } from "../../src/lib/honestyCopy";
import type { ListingScanStatus, Walkthrough } from "../../src/lib/types";
import { policyVersionFromConfig, scanThresholdsFromConfig } from "../lib/geofence";
import { pgCode } from "../lib/pgError";
import { presignGetOrNull, SCAN_MAX_STILLS, SCAN_URL_TTL_SECONDS } from "../lib/scanStorage";
import { isHiddenSeedListing } from "../lib/seedInventory";
import { getConfigMap, getListingForViewer, listActiveListings } from "../queries/listings";
import { createScan, getScanTarget, latestScanForOwner } from "../queries/scans";
import { walkthroughForViewer } from "../queries/walkthrough";
import { scanRoutes } from "./scans";
import {
  addListingPhoto,
  createListing,
  deleteListing,
  deleteListingPhoto,
  hostOwnsListing,
  listHostListings,
  updateListing,
} from "../queries/hostListings";
import {
  listingPhotoKey,
  presignImageUpload,
  publicUrlForKey,
  StorageError,
  storageConfigured,
} from "../lib/storage";

export const listingsRoutes = new Hono<AppEnv>();

// HM-02: the upload package lives on its own module; the paths start with
// /:id/scans/:scanId so they never collide with /:id.
listingsRoutes.route("/", scanRoutes);

/**
 * Timezone is load-bearing, not cosmetic: the escrow crons convert check-in
 * and checkout with `AT TIME ZONE listings.timezone`, and an unknown zone
 * makes Postgres raise inside a scheduled job rather than here. Reject it at
 * the door.
 */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const amenitiesSchema = z.object({
  bedrooms: z.number().int().min(0).max(50).optional(),
  beds: z.number().int().min(0).max(50).optional(),
  wifi: z.boolean().optional(),
  kitchen: z.boolean().optional(),
  fireplace: z.boolean().optional(),
  courtyard: z.boolean().optional(),
});

const listingSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().max(4000).optional(),
  type: z.enum(["entire_home", "apartment", "private_room"]),
  addressLine: z.string().max(240).optional(),
  city: z.string().trim().min(1).max(140),
  region: z.string().max(140).optional(),
  country: z.string().trim().length(2).toUpperCase(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().refine(isValidTimeZone, "Not a recognised IANA time zone"),
  nightlyRateCents: z.number().int().min(1),
  depositCents: z.number().int().min(0),
  maxGuests: z.number().int().min(1).max(50),
  amenities: amenitiesSchema.optional(),
  instantBook: z.boolean().optional(),
  cancellationPolicy: z.enum(["flexible", "moderate", "strict"]).optional(),
  status: z.enum(["draft", "active", "paused"]).optional(),
  // HM-01. A recorded action, so a boolean here becomes a timestamp there.
  confirmCoordinates: z.boolean().optional(),
  // HM-06. The host's own choice about who sees the door (D09).
  approachVisibility: z.enum(["confirmed_stay", "everyone"]).optional(),
});

const photoUploadSchema = z.object({
  contentType: z.string().min(1).max(100),
});

const attachPhotoSchema = z.object({
  key: z.string().min(1).max(500),
});

async function parse<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Those details are not valid",
    });
  }
  return parsed.data as z.infer<T>;
}

listingsRoutes.get("/", async (c) => {
  const filters = parseListingFilters(c.req.query());
  return c.json(await tenantQuery(c, (tx) => listActiveListings(tx, filters)));
});

// Registered before "/:id" on purpose — otherwise "mine" is read as an id.
listingsRoutes.get("/mine", async (c) => {
  const host = sessionUser(c);
  return c.json(await tenantQuery(c, (tx) => listHostListings(tx, host.id)));
});

const CONFIRM_NEEDS_POINT = "Set both latitude and longitude before confirming the front door.";

listingsRoutes.post("/", async (c) => {
  const host = sessionUser(c);
  const input = await parse(c, listingSchema);
  let id: string;
  try {
    id = await tenantQuery(c, (tx) => createListing(tx, host.id, input));
  } catch (err) {
    if (input.confirmCoordinates && pgCode(err) === "23514") {
      throw new HTTPException(400, { message: CONFIRM_NEEDS_POINT });
    }
    throw err;
  }
  return c.json({ id }, 201);
});

listingsRoutes.patch("/:id", async (c) => {
  const host = sessionUser(c);
  const input = await parse(c, listingSchema.partial());
  let ok: boolean;
  try {
    ok = await tenantQuery(c, (tx) => updateListing(tx, host.id, c.req.param("id"), input));
  } catch (err) {
    // listings_confirmed_point_needs_lat_lng: confirming a front door that
    // has no point. The CHECK is the rule; this is the friendly sentence.
    if (input.confirmCoordinates && pgCode(err) === "23514") {
      throw new HTTPException(400, { message: CONFIRM_NEEDS_POINT });
    }
    throw err;
  }
  if (!ok) throw new HTTPException(404, { message: "No listing of yours here" });
  return c.json({ ok: true });
});

/**
 * HM-01. What the capture page needs before it opens a camera: whether the
 * front door is confirmed, whether uploads could land anywhere, the current
 * thresholds for the on-device meter, and the latest scan row. Owner only —
 * a stranger gets the same 404 as for any listing that is not theirs.
 */
/**
 * HM-05: the walkthrough a guest may load. Public for an active listing with
 * a verified scan, and for that listing's own host previewing a draft; a 404
 * for everything else, including a guessed id, a rejected scan and a hidden
 * demo row. The URLs are signed and short-lived, so no bucket path or raw
 * upload prefix ever leaves the server.
 */
listingsRoutes.get("/:id/walkthrough", async (c) => {
  const listingId = c.req.param("id");
  const missing = new HTTPException(404, { message: "We couldn't find this walkthrough." });
  if (isHiddenSeedListing(listingId)) throw missing;
  if (!storageConfigured()) throw missing;

  const found = await tenantQuery(c, async (tx) => {
    const walk = await walkthroughForViewer(tx, listingId);
    if (!walk) return null;
    const listing = await tx.query.listings.findFirst({
      where: eq(listings.id, listingId),
      columns: { title: true },
    });
    return listing ? { walk, title: listing.title } : null;
  });
  if (!found) throw missing;
  const { walk } = found;
  const splatKey = walk.splatKey;
  // No artifact, no walkthrough: there is never a stand-in for a missing one.
  if (!splatKey) throw missing;

  // Bucket signing is a local HMAC, so this holds no transaction open.
  const [splatUrl, stills] = await Promise.all([
    presignGetOrNull(splatKey),
    Promise.all(walk.stillsKeys.slice(0, SCAN_MAX_STILLS).map((key) => presignGetOrNull(key))),
  ]);
  if (!splatUrl) throw missing;

  const body: Walkthrough = {
    listingId,
    title: found.title,
    timezone: walk.timezone,
    capturedOn: walk.capturedOn,
    verifiedAt: walk.verifiedAt,
    coverage: walk.coverage,
    policyVersion: walk.policyVersion,
    ownerPreview: walk.ownerPreview,
    posterUrl: stills[0] ?? null,
    splatUrl,
    stills: stills
      .map((url, index) => (url ? { index, url } : null))
      .filter((s): s is { index: number; url: string } => s !== null),
    expiresInSeconds: SCAN_URL_TTL_SECONDS,
  };
  return c.json(body);
});

listingsRoutes.get("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const status = await tenantQuery(c, async (tx): Promise<ListingScanStatus | null> => {
    const target = await getScanTarget(tx, host.id, listingId);
    if (!target) return null;
    const config = await getConfigMap(tx);
    const scan = await latestScanForOwner(tx, host.id, listingId);
    return {
      listingId,
      coordinatesConfirmed: target.confirmed,
      storageConfigured: storageConfigured(),
      thresholds: scanThresholdsFromConfig(config),
      policyVersion: policyVersionFromConfig(config),
      scan,
    };
  });
  if (!status) throw new HTTPException(404, { message: "No listing of yours here" });
  return c.json(status);
});

/**
 * Start a walk-scan: one `capturing` row with the thresholds, the target
 * point and the policy version frozen onto it. Refused for a demo home,
 * without object storage (there would be nowhere for the walk to go), and
 * before the front door is confirmed. The INSERT policy enforces the last
 * rule too; the 409 is the friendly version.
 */
listingsRoutes.post("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  if (isHiddenSeedListing(listingId)) {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.demoListing });
  }
  if (!storageConfigured()) {
    throw new HTTPException(503, { message: HONESTY_REFUSALS.storageNotConfigured });
  }
  const result = await tenantQuery(c, async (tx) => {
    const target = await getScanTarget(tx, host.id, listingId);
    if (!target) return { kind: "missing" as const };
    if (!target.confirmed || target.lat === null || target.lng === null) {
      return { kind: "unconfirmed" as const };
    }
    const config = await getConfigMap(tx);
    const scan = await createScan(tx, {
      hostId: host.id,
      listingId,
      thresholds: scanThresholdsFromConfig(config),
      policyVersion: policyVersionFromConfig(config),
      target: { lat: target.lat, lng: target.lng },
    });
    return { kind: "created" as const, scan };
  });
  if (result.kind === "missing") throw new HTTPException(404, { message: "No listing of yours here" });
  if (result.kind === "unconfirmed") {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.coordinatesUnconfirmed });
  }
  return c.json(result.scan, 201);
});

listingsRoutes.delete("/:id", async (c) => {
  const host = sessionUser(c);
  try {
    const ok = await tenantQuery(c, (tx) => deleteListing(tx, host.id, c.req.param("id")));
    if (!ok) throw new HTTPException(404, { message: "No listing of yours here" });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // bookings.listing_id is ON DELETE RESTRICT: a stay someone paid for does
    // not vanish because a host tidied up.
    throw new HTTPException(409, {
      message: "This home has bookings against it. Pause it instead of deleting it.",
    });
  }
  return c.json({ ok: true });
});

/**
 * Hands back a short-lived PUT URL. The key is built server-side from the
 * listing id and a random segment, so a client cannot choose where its file
 * lands, and the content type is signed so it cannot lie about what it is.
 */
listingsRoutes.post("/:id/photo-upload", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const { contentType } = await parse(c, photoUploadSchema);

  if (!storageConfigured()) {
    throw new HTTPException(503, { message: "Photo uploads are not configured here" });
  }
  const owns = await tenantQuery(c, (tx) => hostOwnsListing(tx, host.id, listingId));
  if (!owns) throw new HTTPException(404, { message: "No listing of yours here" });

  try {
    return c.json(await presignImageUpload(listingPhotoKey(listingId, contentType), contentType));
  } catch (err) {
    if (err instanceof StorageError) throw new HTTPException(400, { message: err.message });
    throw err;
  }
});

/** Called after the browser has PUT the file, to record it against the listing. */
listingsRoutes.post("/:id/photos", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const { key } = await parse(c, attachPhotoSchema);

  // The key must sit under this listing's prefix. Without this a host could
  // attach an object belonging to someone else's listing.
  if (!key.startsWith(`listings/${listingId}/`)) {
    throw new HTTPException(400, { message: "That upload does not belong to this listing" });
  }
  const owns = await tenantQuery(c, (tx) => hostOwnsListing(tx, host.id, listingId));
  if (!owns) throw new HTTPException(404, { message: "No listing of yours here" });

  const id = await tenantQuery(c, (tx) => addListingPhoto(tx, listingId, publicUrlForKey(key)));
  return c.json({ id }, 201);
});

listingsRoutes.delete("/photos/:photoId", async (c) => {
  sessionUser(c);
  // listing_photos_host_write scopes this to the caller's own listings, so a
  // photo on someone else's listing simply is not there to delete.
  const ok = await tenantQuery(c, (tx) => deleteListingPhoto(tx, c.req.param("photoId")));
  if (!ok) throw new HTTPException(404, { message: "No photo of yours here" });
  return c.json({ ok: true });
});

listingsRoutes.get("/:id", async (c) => {
  const viewer = c.get("user");
  const listing = await tenantQuery(c, (tx) =>
    getListingForViewer(tx, c.req.param("id"), viewer?.id ?? null),
  );
  if (!listing) {
    throw new HTTPException(404, {
      message: "No listing here. It may be paused, or the link is stale.",
    });
  }
  return c.json(listing);
});
