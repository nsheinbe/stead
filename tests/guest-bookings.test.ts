/**
 * Soft Dist guest-booking kill-switch.
 *
 * ALLOW_GUEST_BOOKINGS=1 is required to create a booking (and therefore stay
 * payment / setup intents). Unset or 0 refuses fail-closed. Tests that need
 * a live create set the flag on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import {
  allowGuestBookings,
  GUEST_BOOKINGS_CLOSED_MESSAGE,
} from "../server/lib/guestBookings";
import { toPublicConfig } from "../server/queries/listings";
import { BOOKINGS_CLOSED_COPY, guestBookingsOpen } from "../src/lib/guestBookings";
import { closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function restoreFlag(saved: string | undefined) {
  if (saved === undefined) delete process.env.ALLOW_GUEST_BOOKINGS;
  else process.env.ALLOW_GUEST_BOOKINGS = saved;
}

describe("allowGuestBookings", () => {
  it("is off when unset, 0, or anything other than 1", () => {
    expect(allowGuestBookings({})).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: undefined })).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "" })).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "0" })).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "true" })).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "yes" })).toBe(false);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "on" })).toBe(false);
  });

  it("is on only for ALLOW_GUEST_BOOKINGS=1", () => {
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: "1" })).toBe(true);
    expect(allowGuestBookings({ ALLOW_GUEST_BOOKINGS: " 1 " })).toBe(true);
  });
});

describe("guest booking closed copy", () => {
  it("names the Soft Dist state without implying a reservation", () => {
    expect(BOOKINGS_CLOSED_COPY.title).toMatch(/not open for bookings yet/i);
    expect(GUEST_BOOKINGS_CLOSED_MESSAGE).toMatch(/aren't open yet/i);
    expect(guestBookingsOpen(undefined)).toBe(false);
    expect(guestBookingsOpen({ guestBookingsOpen: false })).toBe(false);
    expect(guestBookingsOpen({ guestBookingsOpen: true })).toBe(true);
  });

  it("surfaces the flag on public config", () => {
    const saved = process.env.ALLOW_GUEST_BOOKINGS;
    try {
      delete process.env.ALLOW_GUEST_BOOKINGS;
      expect(toPublicConfig({}).guestBookingsOpen).toBe(false);
      process.env.ALLOW_GUEST_BOOKINGS = "0";
      expect(toPublicConfig({}).guestBookingsOpen).toBe(false);
      process.env.ALLOW_GUEST_BOOKINGS = "1";
      expect(toPublicConfig({}).guestBookingsOpen).toBe(true);
    } finally {
      restoreFlag(saved);
    }
  });
});

describe("POST /api/bookings refuses when the flag is off", () => {
  const saved = process.env.ALLOW_GUEST_BOOKINGS;

  beforeAll(() => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
  });

  afterEach(() => {
    restoreFlag(saved);
  });

  async function create(flag: string | undefined, body?: unknown) {
    if (flag === undefined) delete process.env.ALLOW_GUEST_BOOKINGS;
    else process.env.ALLOW_GUEST_BOOKINGS = flag;
    const cookie = await mintSessionCookie({
      id: id(),
      email: "guest-closed@stead.example",
      name: "Closed Guest",
    });
    return app.request("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        body ?? {
          listingId: "11111111-1111-1111-1111-111111111111",
          checkIn: isoDay(40),
          checkOut: isoDay(70),
          guests: 2,
        },
      ),
    });
  }

  it("refuses when unset", async () => {
    const res = await create(undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: GUEST_BOOKINGS_CLOSED_MESSAGE });
  });

  it("refuses when ALLOW_GUEST_BOOKINGS=0", async () => {
    const res = await create("0");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: GUEST_BOOKINGS_CLOSED_MESSAGE });
  });
});

describeDb("POST /api/bookings allows when ALLOW_GUEST_BOOKINGS=1", () => {
  const saved = process.env.ALLOW_GUEST_BOOKINGS;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterEach(() => {
    restoreFlag(saved);
  });

  afterAll(async () => {
    restoreFlag(saved);
    await closeTestDb();
  });

  it("creates a mock booking when the flag is on", async () => {
    process.env.ALLOW_GUEST_BOOKINGS = "1";
    const hostId = id();
    const guestId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Open Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Open Guest");
    await insertListing({ id: listingId, hostId, title: "Open cottage" });
    const cookie = await mintSessionCookie({
      id: guestId,
      email: `guest-${guestId}@stead.example`,
      name: "Open Guest",
    });

    const res = await app.request("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        listingId,
        checkIn: isoDay(80),
        checkOut: isoDay(110),
        guests: 2,
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      bookingId: string;
      mockPayment: boolean;
      paymentClientSecret: string | null;
      setupClientSecret: string | null;
    };
    expect(body.bookingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.mockPayment).toBe(true);
    expect(body.paymentClientSecret).toBeNull();
    expect(body.setupClientSecret).toBeNull();
  });
});
