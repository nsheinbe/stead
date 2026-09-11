import { describe, expect, it } from "vitest";
import { resolveCallbackUrl } from "../server/auth";

const BASE = "https://openstead.app";

describe("resolveCallbackUrl (Auth.js redirect boundary)", () => {
  it("keeps a same-origin application path with its allowed query", () => {
    expect(resolveCallbackUrl(`${BASE}/book/abc?draft=d1`, BASE)).toBe(`${BASE}/book/abc?draft=d1`);
    expect(resolveCallbackUrl(`${BASE}/host/start`, BASE)).toBe(`${BASE}/host/start`);
    expect(resolveCallbackUrl(`${BASE}/messages/abc`, BASE)).toBe(`${BASE}/messages/abc`);
    expect(resolveCallbackUrl("/explore?city=Hudson", BASE)).toBe(`${BASE}/explore?city=Hudson`);
    expect(resolveCallbackUrl(BASE, BASE)).toBe(`${BASE}/`);
  });

  it("sends foreign origins to the default destination", () => {
    expect(resolveCallbackUrl("https://evil.example/trips", BASE)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl("//evil.example/trips", BASE)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl("https://openstead.app.evil.example/", BASE)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl("javascript:alert(1)", BASE)).toBe(`${BASE}/trips`);
  });

  it("never loops back into the sign-in page or the API", () => {
    expect(resolveCallbackUrl(`${BASE}/login?next=%2Ftrips`, BASE)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl(`${BASE}/api/auth/signin`, BASE)).toBe(`${BASE}/trips`);
  });

  it("drops unknown routes and unknown query keys", () => {
    expect(resolveCallbackUrl(`${BASE}/admin`, BASE)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl(`${BASE}/trips?token=abc`, BASE)).toBe(`${BASE}/trips`);
  });

  it("ignores a base path in baseUrl and survives a malformed one", () => {
    expect(resolveCallbackUrl("/trips", `${BASE}/api/auth`)).toBe(`${BASE}/trips`);
    expect(resolveCallbackUrl("/trips", "not a url")).toBe("/trips");
  });
});
