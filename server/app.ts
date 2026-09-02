/**
 * The whole Stead API. One Hono app, mounted three ways: a Vercel function in
 * api/, Vite's dev server via @hono/vite-dev-server, and a plain Node server
 * for anyone self-hosting.
 *
 * It replaces both halves of the old Supabase runtime — PostgREST (the browser
 * used to query Postgres directly under RLS) and the Deno edge functions. RLS
 * itself stayed: the browser no longer holds a database role, so the request's
 * member id travels as a transaction-local setting instead. See
 * drizzle/0002_roles_and_rls.sql.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { handleAuthRequest } from "./auth";
import { PrivilegedRoleError } from "./db/client";
import { requireUser, tenantQuery, withSession, type AppEnv } from "./lib/http";
import { bookingsRoutes, tripsRoutes } from "./routes/bookings";
import { cronRoutes } from "./routes/cron";
import { listingsRoutes } from "./routes/listings";
import { stripeRoutes } from "./routes/stripe";
import { getConfigMap, toPublicConfig } from "./queries/listings";
import type { SessionResponse } from "../src/lib/types";

export const app = new Hono<AppEnv>().basePath("/api");

// Liveness only — no session, no database. Used to verify the Vercel function
// packed server/ correctly (a missing module crashes before Hono can answer).
app.get("/health", (c) => c.json({ ok: true }));

// Auth.js owns /api/auth/*: csrf, signin, callback, session, signout. It runs on
// the auth_user connection, which reaches the identity tables and nothing else.
app.all("/auth/*", (c) => handleAuthRequest(c.req.raw));

app.use("*", withSession);

app.get("/me", (c) => {
  const body: SessionResponse = { user: c.get("user") };
  return c.json(body);
});

app.get("/config", async (c) => c.json(toPublicConfig(await tenantQuery(c, getConfigMap))));

app.route("/listings", listingsRoutes);

// Stripe and the scheduler authenticate themselves; they are not members.
app.route("/stripe", stripeRoutes);
app.route("/cron", cronRoutes);

app.use("/trips", requireUser);
app.use("/trips/*", requireUser);
app.route("/trips", tripsRoutes);

app.use("/bookings", requireUser);
app.route("/bookings", bookingsRoutes);

app.notFound((c) => c.json({ error: "No such endpoint" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof PrivilegedRoleError) {
    // Misconfiguration, not a bug in a request. Loud in the log, opaque to the caller.
    console.error(err.message);
    return c.json({ error: "This deployment is misconfigured and is not serving data." }, 503);
  }
  console.error("api error:", err);
  return c.json({ error: "Something went wrong on our side." }, 500);
});

export default app;
