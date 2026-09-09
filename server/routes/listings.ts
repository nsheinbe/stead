import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { getListingForViewer, listActiveListings } from "../queries/listings";
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
  return c.json(await tenantQuery(c, (tx) => listActiveListings(tx)));
});

// Registered before "/:id" on purpose — otherwise "mine" is read as an id.
listingsRoutes.get("/mine", async (c) => {
  const host = sessionUser(c);
  return c.json(await tenantQuery(c, (tx) => listHostListings(tx, host.id)));
});

listingsRoutes.post("/", async (c) => {
  const host = sessionUser(c);
  const input = await parse(c, listingSchema);
  const id = await tenantQuery(c, (tx) => createListing(tx, host.id, input));
  return c.json({ id }, 201);
});

listingsRoutes.patch("/:id", async (c) => {
  const host = sessionUser(c);
  const input = await parse(c, listingSchema.partial());
  const ok = await tenantQuery(c, (tx) => updateListing(tx, host.id, c.req.param("id"), input));
  if (!ok) throw new HTTPException(404, { message: "No listing of yours here" });
  return c.json({ ok: true });
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
