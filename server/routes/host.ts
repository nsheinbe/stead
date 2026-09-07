/** Host-facing money views. Reads only — the ledger is written by the webhook. */
import { Hono } from "hono";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { listHostPayouts } from "../queries/payouts";

export const hostRoutes = new Hono<AppEnv>();

hostRoutes.get("/payouts", async (c) => {
  const host = sessionUser(c);
  return c.json(await tenantQuery(c, (tx) => listHostPayouts(tx, host.id)));
});
