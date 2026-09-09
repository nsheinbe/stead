/**
 * Process-local sliding-window limiter for sensitive /api writes.
 *
 * Enough to blunt burst abuse on one Vercel instance. It is not a shared
 * store — two instances do not see each other. That is documented, not a
 * surprise: Slice 8 asked for edge-function rate limiting, not a Redis
 * dependency.
 *
 * Webhooks and cron endpoints are deliberately not limited. Stripe retries
 * and the scheduler must not be dropped; the webhook is already idempotent
 * via stripe_events.
 */
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./http";

export type RateLimitRule = {
  name: string;
  windowMs: number;
  max: number;
};

type Bucket = { timestamps: number[] };

const store = new Map<string, Bucket>();

export const RATE_LIMITS = {
  bookings: { name: "bookings", windowMs: 15 * 60_000, max: 8 },
  cancel: { name: "cancel", windowMs: 15 * 60_000, max: 8 },
  messages: { name: "messages", windowMs: 15 * 60_000, max: 30 },
  claims: { name: "claims", windowMs: 15 * 60_000, max: 10 },
  identity: { name: "identity", windowMs: 60 * 60_000, max: 5 },
} as const satisfies Record<string, RateLimitRule>;

export function resetRateLimitStore(): void {
  store.clear();
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRule(rule: RateLimitRule): { windowMs: number; max: number } {
  const key = rule.name.toUpperCase();
  return {
    windowMs: envInt(`RATE_LIMIT_${key}_WINDOW_MS`, rule.windowMs),
    max: envInt(`RATE_LIMIT_${key}_MAX`, rule.max),
  };
}

export function rateLimitDisabled(): boolean {
  const flag = process.env.RATE_LIMIT_DISABLED;
  return flag === "1" || flag === "true";
}

/** Member id when signed in, otherwise the first forwarded hop. */
export function clientKey(c: Context<AppEnv>): string {
  const userId = c.get("user")?.id;
  if (userId) return `user:${userId}`;
  const forwarded = c.req.header("x-forwarded-for");
  const hop = forwarded?.split(",")[0]?.trim();
  const ip = hop || c.req.header("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

export function takeToken(
  bucketKey: string,
  windowMs: number,
  max: number,
  now = Date.now(),
): { ok: boolean; remaining: number; resetMs: number } {
  const bucket = store.get(bucketKey) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((stamp) => stamp > cutoff);
  if (bucket.timestamps.length >= max) {
    store.set(bucketKey, bucket);
    const oldest = bucket.timestamps[0] ?? now;
    return { ok: false, remaining: 0, resetMs: Math.max(0, oldest + windowMs - now) };
  }
  bucket.timestamps.push(now);
  store.set(bucketKey, bucket);
  return { ok: true, remaining: max - bucket.timestamps.length, resetMs: windowMs };
}

export function rateLimit(rule: RateLimitRule): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (rateLimitDisabled()) {
      await next();
      return;
    }
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }
    const { windowMs, max } = resolveRule(rule);
    const result = takeToken(`${rule.name}:${clientKey(c)}`, windowMs, max);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.ok) {
      const retryAfter = Math.max(1, Math.ceil(result.resetMs / 1000));
      c.header("Retry-After", String(retryAfter));
      throw new HTTPException(429, { message: "Too many requests. Try again shortly." });
    }
    await next();
  };
}
