/**
 * MEAS-01. What may leave the browser, and what may not.
 *
 * Analytics is where personal data leaks by accident: a route serialized with
 * an id in it, an "error" property carrying a stack trace, a member_key that
 * is really an email. So the contract is tested as a boundary, not as a
 * formatter — every case here is something that must NOT be sent.
 *
 * The other half is authority. A browser can be opened by anyone and its
 * payloads forged, so it cannot be the thing that says a booking was confirmed
 * or a member verified. Those are server facts, and the builder refuses to
 * make one from client code.
 */
import { describe, expect, it } from "vitest";
import {
  buildEvent,
  countBucket,
  forbiddenShape,
  guestBucket,
  isServerOwnedEvent,
  nightsBucket,
  routeNameFor,
  ROUTE_NAMES,
  SCHEMA_VERSION,
  type BuildInput,
} from "../src/lib/analytics";

function base(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    event_name: "listing_viewed",
    origin: "client",
    environment: "test",
    release_id: "test-release",
    now: () => new Date("2026-09-11T00:00:00.000Z"),
    newId: () => "fixed-event-id",
    ...overrides,
  };
}

function built(overrides: Partial<BuildInput> = {}) {
  const result = buildEvent(base(overrides));
  if (!result.ok) throw new Error(`expected a valid event, got: ${result.reason}`);
  return result.event;
}

describe("a route is a template, never a URL", () => {
  it("maps every dynamic route to its template", () => {
    expect(routeNameFor("/listing/9f3c1d2e-1111-2222-3333-444455556666")).toBe("listing_detail");
    expect(routeNameFor("/book/9f3c1d2e")).toBe("checkout");
    expect(routeNameFor("/trips/9f3c1d2e")).toBe("trip_detail");
    expect(routeNameFor("/messages/abc/def")).toBe("conversation");
    expect(routeNameFor("/review/abc")).toBe("review");
    expect(routeNameFor("/passport/abc")).toBe("profile");
    expect(routeNameFor("/host/listings/abc")).toBe("host_listing_edit");
    expect(routeNameFor("/host/claims/abc")).toBe("host_claim_detail");
  });

  it("never returns anything but an allowlisted name", () => {
    const paths = [
      "/",
      "/explore",
      "/listing/secret-id",
      "/host/listings/secret-id",
      "/nonsense/path/here",
      "/messages/a/b",
      "",
      "///",
    ];
    for (const path of paths) {
      expect(ROUTE_NAMES).toContain(routeNameFor(path));
    }
  });

  it("falls back to not_found rather than echoing the path", () => {
    const name = routeNameFor("/some/unknown/9f3c1d2e-1111-2222-3333-444455556666");
    expect(name).toBe("not_found");
    expect(name).not.toContain("9f3c");
  });
});

describe("nothing personal reaches a payload", () => {
  it("recognises the shapes that must never be sent", () => {
    expect(forbiddenShape("ada@example.com")).toBe("email address");
    expect(forbiddenShape("https://stead.example/listing/1")).toBe("URL");
    expect(forbiddenShape("sk_live_abc123")).toBe("Stripe secret or key");
    expect(forbiddenShape("pi_123_secret_456")).toBe("Stripe secret or key");
    expect(forbiddenShape("Bearer abc.def.ghi")).toBe("bearer token");
    expect(forbiddenShape("9f3c1d2e-1111-2222-3333-444455556666")).toBe("UUID");
    expect(forbiddenShape("2026-11-01")).toBe("ISO date");
    expect(forbiddenShape("30-59")).toBeNull();
    expect(forbiddenShape(42)).toBeNull();
    expect(forbiddenShape(true)).toBeNull();
  });

  it("refuses the whole event when a value looks personal", () => {
    // Dropping just the field would leave the mistake in place, unnoticed.
    const result = buildEvent(
      base({ properties: { availability_state: "guest ada@example.com asked" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/email address/);
  });

  it("refuses travel dates, which are the property most likely to slip through", () => {
    const result = buildEvent(
      base({ event_name: "checkout_reviewed", properties: { quote_state: "2026-11-01" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/ISO date/);
  });

  it("refuses a member_key that is really an email", () => {
    const result = buildEvent(base({ member_key: "ada@example.com" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pseudonym/);
  });

  it("drops a property that is not on this event's allowlist", () => {
    const event = built({
      properties: {
        photo_count_bucket: "1-3",
        // Not allowed on listing_viewed, and never allowed anywhere.
        guest_email: "ada@example.com",
        street: "14 Mill Lane",
      },
    });
    expect(event.properties).toEqual({ photo_count_bucket: "1-3" });
    expect(JSON.stringify(event)).not.toContain("Mill Lane");
  });

  it("keeps one event's properties out of another's", () => {
    // `error_family` belongs to auth_link_failed, not to listing_viewed.
    const event = built({ properties: { error_family: "network" } });
    expect(event.properties).toEqual({});
  });
});

describe("the browser cannot declare an outcome", () => {
  it("knows which events only the server may emit", () => {
    expect(isServerOwnedEvent("booking_confirmed")).toBe(true);
    expect(isServerOwnedEvent("signup_verified")).toBe(true);
    expect(isServerOwnedEvent("renter_activated")).toBe(true);
    expect(isServerOwnedEvent("homeowner_activated")).toBe(true);
    expect(isServerOwnedEvent("listing_viewed")).toBe(false);
    expect(isServerOwnedEvent("search_applied")).toBe(false);
  });

  it("refuses to build a server fact from client code", () => {
    for (const name of ["booking_confirmed", "signup_verified", "renter_activated"] as const) {
      const result = buildEvent(base({ event_name: name, origin: "client" }));
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/server fact/);
    }
  });

  it("allows the same events from the server", () => {
    const result = buildEvent(base({ event_name: "booking_confirmed", origin: "server" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an event name that is not in the catalog", () => {
    const result = buildEvent(base({ event_name: "free_money" as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown event/);
  });

  it("rejects a route or source outside the allowlist", () => {
    expect(buildEvent(base({ route_name: "/listing/abc" as never })).ok).toBe(false);
    expect(buildEvent(base({ source: "wherever" as never })).ok).toBe(false);
  });
});

describe("the envelope", () => {
  it("carries the version, origin and a stable id", () => {
    const event = built();
    expect(event.schema_version).toBe(SCHEMA_VERSION);
    expect(event.event_id).toBe("fixed-event-id");
    expect(event.occurred_at).toBe("2026-09-11T00:00:00.000Z");
    expect(event.origin).toBe("client");
  });

  it("defaults intent to unknown rather than guessing", () => {
    // Inferring "homeowner" from a later action would rewrite acquisition
    // history, which the measurement contract forbids.
    expect(built().event_intent).toBe("unknown");
    expect(built({ event_intent: "homeowner" }).event_intent).toBe("homeowner");
  });

  it("omits optional fields instead of sending empty ones", () => {
    const event = built();
    expect(event).not.toHaveProperty("member_key");
    expect(event).not.toHaveProperty("journey_id");
    expect(event).not.toHaveProperty("signup_intent");
    expect(event).not.toHaveProperty("experiment");
  });
});

describe("buckets are defined once, in code", () => {
  it("buckets nights against the 30-night floor", () => {
    expect(nightsBucket(30)).toBe("30-59");
    expect(nightsBucket(59)).toBe("30-59");
    expect(nightsBucket(60)).toBe("60-89");
    expect(nightsBucket(90)).toBe("90+");
    expect(nightsBucket(365)).toBe("90+");
    // Below the minimum is not a short stay — it is not a stay at all.
    expect(nightsBucket(29)).toBe("invalid");
    expect(nightsBucket(0)).toBe("invalid");
    expect(nightsBucket(Number.NaN)).toBe("invalid");
  });

  it("buckets counts and party sizes without leaking the exact number", () => {
    expect(countBucket(0)).toBe("0");
    expect(countBucket(3)).toBe("1-3");
    expect(countBucket(11)).toBe("11-50");
    expect(countBucket(1000)).toBe("50+");
    expect(guestBucket(1)).toBe("1");
    expect(guestBucket(2)).toBe("2");
    expect(guestBucket(4)).toBe("3-4");
    expect(guestBucket(9)).toBe("5+");
  });
});
