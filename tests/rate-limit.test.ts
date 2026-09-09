/**
 * Slice 8 — process-local rate limiter. Isolated from Auth.js and Postgres so
 * the quota math is what fails, not a session cookie.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { rateLimit, RATE_LIMITS, resetRateLimitStore, takeToken, type RateLimitRule } from "../server/lib/rateLimit";
import type { AppEnv } from "../server/lib/http";
import { app } from "../server/app";

function withErrors<T extends Hono<AppEnv>>(api: T): T {
  api.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    return c.json({ error: "error" }, 500);
  });
  return api;
}

afterEach(() => {
  resetRateLimitStore();
  delete process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_TEST_MAX;
});

describe("takeToken", () => {
  it("admits up to max hits in the window, then refuses", () => {
    const now = 1_000_000;
    expect(takeToken("k", 60_000, 2, now)).toMatchObject({ ok: true, remaining: 1 });
    expect(takeToken("k", 60_000, 2, now + 10)).toMatchObject({ ok: true, remaining: 0 });
    expect(takeToken("k", 60_000, 2, now + 20)).toMatchObject({ ok: false, remaining: 0 });
  });

  it("forgets hits that have left the window", () => {
    const now = 2_000_000;
    expect(takeToken("w", 1_000, 1, now).ok).toBe(true);
    expect(takeToken("w", 1_000, 1, now + 999).ok).toBe(false);
    expect(takeToken("w", 1_000, 1, now + 1_001).ok).toBe(true);
  });

  it("keeps buckets isolated by key", () => {
    const now = 3_000_000;
    expect(takeToken("a", 60_000, 1, now).ok).toBe(true);
    expect(takeToken("b", 60_000, 1, now).ok).toBe(true);
    expect(takeToken("a", 60_000, 1, now + 1).ok).toBe(false);
  });
});

describe("rateLimit middleware", () => {
  const rule: RateLimitRule = { name: "test", windowMs: 60_000, max: 2 };

  function mini() {
    const api = new Hono<AppEnv>();
    api.use("*", async (c, next) => {
      c.set("user", { id: "member-1", email: "a@stead.example", name: "A" });
      await next();
    });
    api.post("/write", rateLimit(rule), (c) => c.json({ ok: true }));
    api.get("/read", rateLimit(rule), (c) => c.json({ ok: true }));
    return withErrors(api);
  }

  it("returns 429 with Retry-After after the quota", async () => {
    const api = mini();
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    const blocked = await api.request("/write", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(await blocked.json()).toEqual({ error: "Too many requests. Try again shortly." });
  });

  it("does not count GET against the write quota", async () => {
    const api = mini();
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    expect((await api.request("/read")).status).toBe(200);
    expect((await api.request("/write", { method: "POST" })).status).toBe(429);
  });

  it("keys signed-in members separately from an IP", async () => {
    const api = new Hono<AppEnv>();
    api.post(
      "/write",
      async (c, next) => {
        const id = c.req.header("x-member") ?? null;
        c.set("user", id ? { id, email: `${id}@stead.example`, name: id } : null);
        await next();
      },
      rateLimit({ name: "split", windowMs: 60_000, max: 1 }),
      (c) => c.json({ ok: true }),
    );
    withErrors(api);

    expect((await api.request("/write", { method: "POST", headers: { "x-member": "a" } })).status).toBe(
      200,
    );
    expect((await api.request("/write", { method: "POST", headers: { "x-member": "b" } })).status).toBe(
      200,
    );
    expect((await api.request("/write", { method: "POST", headers: { "x-member": "a" } })).status).toBe(
      429,
    );
  });

  it("can be disabled for a local session", async () => {
    process.env.RATE_LIMIT_DISABLED = "1";
    const api = mini();
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
    expect((await api.request("/write", { method: "POST" })).status).toBe(200);
  });
});

describe("sensitive routes vs the webhook", () => {
  it("does not 429 the Stripe webhook — retries must land", async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await app.request("/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      statuses.push(res.status);
    }
    expect(statuses.every((status) => status !== 429)).toBe(true);
    expect(RATE_LIMITS.bookings.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.cancel.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.messages.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.claims.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.identity.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.connect.max).toBeGreaterThan(0);
  });
});
