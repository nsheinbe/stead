/**
 * Stripe Identity. Creates a VerificationSession for the signed-in member and
 * returns the hosted URL. The webhook is what raises verification_tier to 2 —
 * this route only starts the check and records the session id.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireUser, sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { RATE_LIMITS, rateLimit } from "../lib/rateLimit";
import { getStripe, stripeConfigured } from "../lib/stripe";
import { profileIdVerified, setIdentitySession } from "../queries/trust";

export const identityRoutes = new Hono<AppEnv>();

identityRoutes.use("*", requireUser);

identityRoutes.post("/session", rateLimit(RATE_LIMITS.identity), async (c) => {
  const user = sessionUser(c);
  if (!stripeConfigured()) {
    throw new HTTPException(503, { message: "ID verification is not configured on this deployment." });
  }

  const already = await tenantQuery(c, (tx) => profileIdVerified(tx, user.id));
  if (already) {
    return c.json({ alreadyVerified: true, url: null as string | null });
  }

  const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  let session: { id: string; url: string | null };
  try {
    session = await getStripe().identity.verificationSessions.create(
      {
        type: "document",
        metadata: { user_id: user.id },
        return_url: `${appUrl}/passport/${user.id}?identity=return`,
      },
      { idempotencyKey: `identity:vs:${user.id}` },
    );
  } catch (err) {
    console.error("[identity] could not create a VerificationSession", err);
    throw new HTTPException(502, { message: "Stripe Identity did not start. Try again shortly." });
  }

  if (!session.url) {
    throw new HTTPException(502, { message: "Stripe Identity did not return a verification URL." });
  }

  try {
    await tenantQuery(c, (tx) => setIdentitySession(tx, session.id));
  } catch (err) {
    console.error("[identity] could not record the session id", err);
    throw new HTTPException(500, { message: "Could not start ID verification." });
  }

  return c.json({ alreadyVerified: false, url: session.url });
});
