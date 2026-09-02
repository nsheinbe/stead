/**
 * The Vercel function used to crash on import:
 *   Cannot find module '/var/task/server/app'
 * because the Vite builder left an extensionless ESM specifier in api/index.js.
 * These tests pin the routes the production probe hits, and that the serverless
 * bundle inlines server/ so Node never has to resolve that path.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { app } from "../server/app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "dist-api/handler.js");

describe("GET /api/health", () => {
  it("returns 200 JSON without a session or database", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/auth/providers", () => {
  it("returns Auth.js providers JSON", async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const res = await app.request("/api/auth/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { id?: string; type?: string }>;
    expect(body.resend).toMatchObject({ id: "resend", type: "email" });
  });
});

describe("Vercel API bundle", () => {
  it("inlines server/ so the function does not import ../server/app", async () => {
    await build({ configFile: path.join(root, "vite.api.config.ts") });
    expect(existsSync(bundlePath)).toBe(true);

    const source = readFileSync(bundlePath, "utf8");
    expect(source).not.toMatch(/from\s+["']\.\.\/server\/app["']/);
    expect(source).not.toMatch(/from\s+["']\.\.\/server\/app\.js["']/);
    expect(source).toContain("/health");

    const bundled = (await import(`${bundlePath}?t=${Date.now()}`)) as {
      app: typeof app;
      default: unknown;
    };
    expect(typeof bundled.default).toBe("function");
    const res = await bundled.app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const entry = (await import(`${path.join(root, "api/index.js")}?t=${Date.now()}`)) as {
      default: unknown;
      config: { runtime: string };
    };
    expect(typeof entry.default).toBe("function");
    expect(entry.config).toEqual({ runtime: "nodejs" });
  });
});
