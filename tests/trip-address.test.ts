/**
 * The other half of the editor's promise.
 *
 * The hint under "Street address" says it twice: the address is "shared with a
 * guest after a stay is confirmed, not on the public page." tests/listing-edit
 * proves the second half — a non-owner's listing read carries none. This proves
 * the first: the guest on a confirmed stay gets it on their trip, and nobody
 * gets it a moment earlier or later.
 *
 * The status table is the point of this file. "Confirmed" has to mean one thing
 * in `getTripForParty` and on the trip page, so `stayIsConfirmed` is asserted
 * against every status the column can hold — a new one cannot be added without
 * a deliberate answer here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import { stayIsConfirmed } from "../src/lib/tripStatus";
import type { BookingStatus, TripDetail } from "../src/lib/types";
import {
  closeTestDb,
  getHarness,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const ADDRESS = "14 Mill Lane";

/** Every status the column can hold, and whether the address travels with it. */
const STATUS_TABLE: { status: BookingStatus; shared: boolean }[] = [
  { status: "pending_payment", shared: false },
  { status: "confirmed", shared: true },
  { status: "checked_in", shared: true },
  { status: "completed", shared: false },
  { status: "canceled_by_guest", shared: false },
  { status: "canceled_by_host", shared: false },
  { status: "expired", shared: false },
];

describe("what counts as confirmed", () => {
  it("answers for every booking status", () => {
    for (const { status, shared } of STATUS_TABLE) {
      expect(stayIsConfirmed(status), status).toBe(shared);
    }
  });
});

describeDb("the street address on a trip", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function aMember(label: string, isHost = false) {
    const memberId = id();
    const email = `${label}-${memberId}@stead.example`;
    await insertMember(memberId, email, label, isHost);
    return { id: memberId, cookie: await mintSessionCookie({ id: memberId, email, name: label }) };
  }

  /** A stay in the given state, on a listing that has an address to share. */
  async function aStay(status: BookingStatus, opts: { addressLine?: string } = {}) {
    const host = await aMember("host", true);
    const guest = await aMember("guest");
    const listingId = id();
    await insertListing({
      id: listingId,
      hostId: host.id,
      addressLine: opts.addressLine ?? ADDRESS,
    });
    // Dates are unique per stay so the exclusion constraint never collides
    // between the cases in the table.
    const day = Math.floor(Math.random() * 900) + 100;
    const bookingId = await insertBooking({
      listingId,
      guestId: guest.id,
      checkIn: isoDay(day),
      checkOut: isoDay(day + 30),
      status,
    });
    return { host, guest, listingId, bookingId };
  }

  function isoDay(offset: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  async function tripAs(bookingId: string, cookie: string) {
    return app.request(`/api/trips/${bookingId}`, { headers: { cookie } });
  }

  it("gives a confirmed guest the address", async () => {
    const stay = await aStay("confirmed");

    const res = await tripAs(stay.bookingId, stay.guest.cookie);
    expect(res.status).toBe(200);
    const trip = (await res.json()) as TripDetail;
    expect(trip.listing.addressLine).toBe(ADDRESS);
  });

  it("gives the host the same address on the same stay", async () => {
    const stay = await aStay("confirmed");

    // The host owns the address already; the point is that the page can show
    // them exactly what their guest is being shown.
    const trip = (await (await tripAs(stay.bookingId, stay.host.cookie)).json()) as TripDetail;
    expect(trip.listing.addressLine).toBe(ADDRESS);
  });

  it("shares it for exactly the statuses that count as confirmed", async () => {
    for (const { status, shared } of STATUS_TABLE) {
      const stay = await aStay(status);
      const res = await tripAs(stay.bookingId, stay.guest.cookie);
      expect(res.status, status).toBe(200);
      const raw = (await res.clone().json()) as { listing: Record<string, unknown> };

      if (shared) {
        expect(raw.listing.addressLine, status).toBe(ADDRESS);
      } else {
        // Absent, not empty: a canceled or unpaid stay carries no address key
        // at all, and the string is nowhere in the payload either.
        expect(raw.listing, status).not.toHaveProperty("addressLine");
        expect(await res.text(), status).not.toContain(ADDRESS);
      }
    }
  });

  it("carries no empty address when the host never set one", async () => {
    const stay = await aStay("confirmed", { addressLine: "" });

    // `listings.address_line` defaults to '' rather than NULL, so without this
    // the page would render a blank line under "Getting in".
    const trip = (await (await tripAs(stay.bookingId, stay.guest.cookie)).json()) as TripDetail;
    expect(trip.listing).not.toHaveProperty("addressLine");
  });

  it("does not put the address on the trips list", async () => {
    const stay = await aStay("confirmed");

    // The list is a summary and stays one. It renders every stay a guest has,
    // confirmed or not, so the address has no business in it.
    const res = await app.request("/api/trips", { headers: { cookie: stay.guest.cookie } });
    expect(res.status).toBe(200);
    const rows = (await res.clone().json()) as { id: string; listing: Record<string, unknown> }[];
    const row = rows.find((r) => r.id === stay.bookingId);
    expect(row).toBeTruthy();
    expect(row?.listing).not.toHaveProperty("addressLine");
    expect(await res.text()).not.toContain(ADDRESS);
  });

  it("keeps it from someone who is neither party", async () => {
    const stay = await aStay("confirmed");
    const stranger = await aMember("stranger");

    // Not a weaker assertion than the 404 in tests/authorization: this is the
    // one that fails loudly if the address ever moves to a wider-read DTO.
    const res = await tripAs(stay.bookingId, stranger.cookie);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(ADDRESS);
  });
});
