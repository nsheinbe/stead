/**
 * The whole Stead API. One Hono app, mounted three ways: a Vercel function in
 * api/, Vite's dev server via @hono/vite-dev-server, and a plain Node server
 * for anyone self-hosting.
 *
 * It replaces both halves of the old Supabase runtime — PostgREST (the browser
 * used to query Postgres directly under RLS) and the Deno edge functions.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { handleAuthRequest } from "./auth";
import { requireUser, withDb, withSession, type AppEnv } from "./lib/http";
import { bookingsRoutes, tripsRoutes } from "./routes/bookings";
import { cronRoutes } from "./routes/cron";
import { listingsRoutes } from "./routes/listings";
import { stripeRoutes } from "./routes/stripe";
import { getConfigMap, toPublicConfig } from "./queries/listings";
import type { SessionResponse } from "../src/lib/types";

export const app = new Hono<AppEnv>().basePath("/api");

app.use("*", withDb);

// Auth.js owns /api/auth/*: csrf, signin, callback, session, signout.
app.all("/auth/*", (c) => handleAuthRequest(c.req.raw));

// Stripe verifies its own signature, so it stays outside the session middleware.
app.route("/stripe", stripeRoutes);
app.route("/cron", cronRoutes);

app.use("*", withSession);

app.get("/me", (c) => {
  const user = c.get("user");
  const body: SessionResponse = { user };
  return c.json(body);
});

app.get("/config", async (c) => c.json(toPublicConfig(await getConfigMap(c.get("db")))));

app.route("/listings", listingsRoutes);

app.use("/trips/*", requireUser);
app.use("/trips", requireUser);
app.route("/trips", tripsRoutes);

app.use("/bookings", requireUser);
app.route("/bookings", bookingsRoutes);

app.notFound((c) => c.json({ error: "No such endpoint" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("api error:", err);
  return c.json({ error: "Something went wrong on our side." }, 500);
});

export default app;
