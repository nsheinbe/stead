import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { tenantQuery, type AppEnv } from "../lib/http";
import { getListingForViewer, listActiveListings } from "../queries/listings";

export const listingsRoutes = new Hono<AppEnv>();

listingsRoutes.get("/", async (c) => {
  return c.json(await tenantQuery(c, (tx) => listActiveListings(tx)));
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
