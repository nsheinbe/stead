import { describe, expect, it } from "vitest";
import { clearLoginContext, readLoginContext, saveLoginContext } from "../src/lib/loginContext";
import { memoryStorage } from "../src/lib/storage";

const NOW = new Date("2026-09-11T12:00:00Z");

describe("login context memory", () => {
  it("remembers a validated destination and its labels, nothing else", () => {
    const storage = memoryStorage();
    saveLoginContext({ next: "/host/start", intent: "homeowner", source: "homeowner_hero" }, storage);
    const raw = storage.getItem("stead:login-context") ?? "";
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["intent", "next", "savedAt", "source"]);
    expect(readLoginContext(storage, NOW)).toEqual({
      next: "/host/start",
      intent: "homeowner",
      source: "homeowner_hero",
    });
  });

  it("re-validates what it reads back", () => {
    const storage = memoryStorage();
    storage.setItem(
      "stead:login-context",
      JSON.stringify({ next: "//evil.example", intent: "admin", source: "x", savedAt: NOW.toISOString() }),
    );
    expect(readLoginContext(storage, NOW)).toEqual({ next: "/trips", intent: "unknown", source: "unknown" });
  });

  it("forgets after a day, on bad data, and on clear", () => {
    const storage = memoryStorage();
    saveLoginContext({ next: "/trips", intent: "renter", source: "header" }, storage);
    expect(readLoginContext(storage, new Date(NOW.getTime() + 25 * 60 * 60 * 1000))).toBeNull();
    expect(storage.length).toBe(0);
    storage.setItem("stead:login-context", "{oops");
    expect(readLoginContext(storage, NOW)).toBeNull();
    saveLoginContext({ next: "/trips", intent: "renter", source: "header" }, storage);
    clearLoginContext(storage);
    expect(readLoginContext(storage, NOW)).toBeNull();
  });

  it("is a no-op without storage", () => {
    saveLoginContext({ next: "/trips", intent: "renter", source: "header" }, null);
    expect(readLoginContext(null, NOW)).toBeNull();
    clearLoginContext(null);
  });
});
