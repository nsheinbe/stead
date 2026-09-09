/**
 * Public Trust Passport + signed export / verify.
 *
 * Export is the canonical JSON of trust_stats, signed Ed25519. Verify is
 * public: anyone with an export can check it against this deployment's key.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { tenantQuery, type AppEnv } from "../lib/http";
import { PassportKeyError, signPassport, verifyPassport, type CanonicalPassport } from "../lib/passport";
import { getPassport, getTrustStats } from "../queries/passport";

export const passportRoutes = new Hono<AppEnv>();

const canonicalSchema = z.object({
  avg_rating_as_guest: z.number().nullable(),
  avg_rating_as_host: z.number().nullable(),
  damage_free_streak: z.number().int(),
  host_cancellations: z.number().int(),
  member_since: z.string().min(1),
  profile_id: z.string().uuid(),
  response_rate: z.number().nullable(),
  review_count: z.number().int(),
  stays_completed: z.number().int(),
  verification_tier: z.number().int().min(0).max(2),
});

const verifySchema = z.object({
  payload: canonicalSchema,
  signature: z.string().min(1),
});

passportRoutes.post("/verify", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: "That export is not a Trust Passport payload" });
  }
  try {
    const ok = verifyPassport(parsed.data.payload as CanonicalPassport, parsed.data.signature);
    return c.json({ valid: ok });
  } catch (err) {
    if (err instanceof PassportKeyError) {
      throw new HTTPException(503, { message: "Passport signing is not configured here" });
    }
    throw err;
  }
});

passportRoutes.get("/:userId/export", async (c) => {
  const stats = await tenantQuery(c, (tx) => getTrustStats(tx, c.req.param("userId")));
  if (!stats) throw new HTTPException(404, { message: "No passport here" });
  try {
    const signed = signPassport(stats);
    return c.json({
      payload: signed.payload,
      signature: signed.signature,
      alg: signed.alg,
    });
  } catch (err) {
    if (err instanceof PassportKeyError) {
      throw new HTTPException(503, { message: "Passport signing is not configured here" });
    }
    throw err;
  }
});

passportRoutes.get("/:userId", async (c) => {
  const passport = await tenantQuery(c, (tx) => getPassport(tx, c.req.param("userId")));
  if (!passport) throw new HTTPException(404, { message: "No passport here" });
  return c.json(passport);
});
