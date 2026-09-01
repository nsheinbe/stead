import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../lib/http";
import { getListingForViewer, listActiveListings } from "../queries/listings";

export const listingsRoutes = new Hono<AppEnv>();

listingsRoutes.get("/", async (c) => {
  return c.json(await listActiveListings(c.get("db")));
});

listingsRoutes.get("/:id", async (c) => {
  const viewer = c.get("user");
  const listing = await getListingForViewer(c.get("db"), c.req.param("id"), viewer?.id ?? null);
  if (!listing) {
    throw new HTTPException(404, { message: "No listing here. It may be paused, or the link is stale." });
  }
  return c.json(listing);
});
