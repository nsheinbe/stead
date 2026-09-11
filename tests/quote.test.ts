/**
 * PAY-01. The quote endpoint previews a price without reserving anything, and
 * the fee label always comes from the rate that produced the cents.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import { feePercent, feeRowLabel, depositExplainer } from "../src/lib/fees";
import { depositMethodForNights, MINIMUM_STAY_DEPOSIT_METHOD } from "../src/lib/deposit";
import { MIN_STAY_NIGHTS } from "../server/lib/pricing";
import { closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function quote(body: unknown, cookie?: string) {
  return app.request("/api/bookings/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("fee labelling", () => {
  it("renders the configured rate, never a hardcoded percentage", () => {
    expect(feePercent(200)).toBe("2%");
    expect(feePercent(250)).toBe("2.5%");
    expect(feePercent(175)).toBe("1.75%");
    expect(feePercent(0)).toBe("0%");
    expect(feeRowLabel(250)).toBe("Guest network fee (2.5%)");
  });

  it("omits the percentage rather than guessing when the rate is unknown", () => {
    expect(feeRowLabel(null)).toBe("Guest network fee");
    expect(feeRowLabel(undefined)).toBe("Guest network fee");
  });
});

describe("deposit wording", () => {
  it("never says money is held for a card-on-file arrangement", () => {
    const text = depositExplainer("card_on_file", 30_000);
    expect(text).toContain("$300");
    expect(text).toContain("separate from your stay charge");
    expect(text).not.toMatch(/held|charged today|returned automatically|escrow/i);
  });

  it("calls an authorization an authorization, not a charge", () => {
    const text = depositExplainer("auth_hold", 30_000);
    expect(text).toMatch(/authorized/i);
    expect(text).toContain("An authorization is not a charge.");
  });

  it("maps stay length to the method the server would choose", () => {
    expect(depositMethodForNights(4)).toBe("auth_hold");
    expect(depositMethodForNights(5)).toBe("card_on_file");
    // Every bookable stay is at or above the minimum, so this is the real case.
    expect(MINIMUM_STAY_DEPOSIT_METHOD).toBe("card_on_file");
    expect(depositMethodForNights(MIN_STAY_NIGHTS)).toBe("card_on_file");
  });
});

describeDb("POST /api/bookings/quote", () => {
  beforeAll(async () => {
    // The session middleware runs on every route, including this public one.
    // Sessions are JWTs, so Auth.js only needs these to construct — it never
    // opens the auth connection to read one.
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    // The route reads through tenantQuery, so it needs the harness's app_user
    // connection — the same non-privileged role RLS applies to in production.
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedListing() {
    const hostId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Quote Host", true);
    await insertListing({ id: listingId, hostId, title: "Quote cottage" });
    return { hostId, listingId };
  }

  it("prices a stay without signing in and without reserving anything", async () => {
    const { listingId } = await seedListing();
    const res = await quote({
      listingId,
      checkIn: isoDay(40),
      checkOut: isoDay(70),
      guests: 2,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      quote: { nights: number; stay_subtotal_cents: number; network_fee_cents: number; guest_total_cents: number; deposit_cents: number };
      networkFeeBps: number;
      depositMethod: string;
      reserved: boolean;
    };

    // $200 x 30 nights at 200 bps: the arithmetic the page must show.
    expect(body.quote.nights).toBe(30);
    expect(body.quote.stay_subtotal_cents).toBe(600_000);
    expect(body.quote.network_fee_cents).toBe(12_000);
    expect(body.quote.guest_total_cents).toBe(612_000);
    // The deposit is quoted but never folded into the payable total.
    expect(body.quote.guest_total_cents).not.toBe(
      body.quote.stay_subtotal_cents + body.quote.network_fee_cents + body.quote.deposit_cents,
    );
    expect(body.networkFeeBps).toBe(200);
    expect(body.depositMethod).toBe("card_on_file");
    expect(body.reserved).toBe(false);
  });

  it("returns no secrets and creates no booking", async () => {
    const { listingId } = await seedListing();
    const res = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(70), guests: 1 });
    const raw = await res.text();
    expect(raw).not.toMatch(/client_secret|clientSecret|pi_|seti_|bookingId/);
  });

  it("keeps the 30-night floor", async () => {
    const { listingId } = await seedListing();
    const res = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(69), guests: 1 });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/30 nights/);
  });

  it("rejects a party the home cannot sleep", async () => {
    const { listingId } = await seedListing();
    const res = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(70), guests: 99 });
    expect(res.status).toBe(400);
  });

  it("does not reveal a listing that is not active", async () => {
    const hostId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Draft Host", true);
    await insertListing({ id: listingId, hostId, title: "Hidden cottage", status: "draft" });
    const res = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(70), guests: 1 });
    expect(res.status).toBe(404);
  });

  it("validates its input", async () => {
    const res = await quote({ listingId: "not-a-uuid", checkIn: "nope", checkOut: "nope", guests: 0 });
    expect(res.status).toBe(400);
  });

  it("prices the same stay identically for a signed-in member", async () => {
    const { listingId } = await seedListing();
    const guestId = id();
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Quote Guest");
    const cookie = await mintSessionCookie({ id: guestId, email: `guest-${guestId}@stead.example` });
    const anon = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(70), guests: 2 });
    const member = await quote({ listingId, checkIn: isoDay(40), checkOut: isoDay(70), guests: 2 }, cookie);
    expect(member.status).toBe(200);
    expect(await member.json()).toEqual(await anon.json());
  });
});
