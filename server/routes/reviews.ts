/**
 * Submit a review for a completed stay. Direction is derived server-side from
 * the session; published_at is never accepted from the client.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { pgMessage } from "../lib/pgError";
import { getReviewForm, submitReview } from "../queries/reviews";

export const reviewsRoutes = new Hono<AppEnv>();

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  body: z.string().max(4000).default(""),
});

reviewsRoutes.get("/:bookingId", async (c) => {
  const viewer = sessionUser(c);
  const form = await tenantQuery(c, (tx) => getReviewForm(tx, c.req.param("bookingId"), viewer.id));
  if (!form) throw new HTTPException(404, { message: "No stay here to review" });
  return c.json(form);
});

reviewsRoutes.post("/:bookingId", async (c) => {
  const viewer = sessionUser(c);
  const bookingId = c.req.param("bookingId");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Those details are not valid",
    });
  }

  let reviewId: string | null;
  try {
    reviewId = await tenantQuery(c, (tx) =>
      submitReview(tx, bookingId, parsed.data.rating, parsed.data.tags, parsed.data.body.trim()),
    );
  } catch (err) {
    const message = pgMessage(err);
    if (/review already submitted/i.test(message)) {
      throw new HTTPException(409, { message: "You already reviewed this stay" });
    }
    if (/stay is not completed/i.test(message)) {
      throw new HTTPException(409, { message: "Reviews open after checkout" });
    }
    if (/rating must be between/i.test(message)) {
      throw new HTTPException(400, { message: "Rating must be between 1 and 5" });
    }
    throw err;
  }

  if (!reviewId) {
    throw new HTTPException(404, { message: "No stay here to review" });
  }

  const form = await tenantQuery(c, (tx) => getReviewForm(tx, bookingId, viewer.id));
  return c.json(form, 201);
});
