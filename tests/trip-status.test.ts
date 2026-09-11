/**
 * LIFE-01. What a stay's status is allowed to say.
 *
 * Two rules carry the weight. Nothing infers a state from the clock — the
 * status column decides, and a hold's expiry is a scheduled job rather than a
 * countdown. And `pending_payment` gets no "finish paying" action: there is no
 * contract for resuming an existing booking's payment, so an action that
 * looked like one would send a guest back to checkout and hold the same dates
 * a second time.
 */
import { describe, expect, it } from "vitest";
import { TRIP_GROUP_LABEL, tripGroup, tripState } from "../src/lib/tripStatus";
import type { BookingStatus } from "../src/lib/types";

const ALL: BookingStatus[] = [
  "pending_payment",
  "confirmed",
  "checked_in",
  "completed",
  "canceled_by_guest",
  "canceled_by_host",
  "expired",
];

function guest(status: BookingStatus, extra: Parameters<typeof tripState>[0] | object = {}) {
  return tripState({ status, listingId: "listing-1", bookingId: "booking-1", ...extra });
}

function host(status: BookingStatus, extra: object = {}) {
  return tripState({
    status,
    listingId: "listing-1",
    bookingId: "booking-1",
    viewerIsHost: true,
    ...extra,
  });
}

describe("every booking status is spoken for", () => {
  it("gives each status a label and a meaning", () => {
    for (const status of ALL) {
      const state = guest(status);
      expect(state.label, status).toBeTruthy();
      expect(state.meaning.length, status).toBeGreaterThan(20);
    }
  });

  it("never labels a status with its raw database value", () => {
    for (const status of ALL) {
      expect(guest(status).label).not.toContain("_");
    }
  });
});

describe("a stay that is not confirmed", () => {
  it("says payment is unrecorded rather than failed", () => {
    const state = guest("pending_payment");
    // Settling and abandoned look identical from here, so the copy has to be
    // true of both.
    expect(state.meaning).toMatch(/haven't recorded payment/i);
    expect(state.meaning).not.toMatch(/failed|declined|successful/i);
    expect(state.settled).toBe(false);
  });

  it("offers no action that would hold the same dates twice", () => {
    const state = guest("pending_payment");
    expect(state.action?.to).not.toMatch(/^\/book\//);
    expect(state.action?.label ?? "").not.toMatch(/pay|finish|retry|complete/i);
  });

  it("does not describe the hold as already gone", () => {
    expect(guest("pending_payment").closed).toBe(false);
    expect(guest("pending_payment").label).not.toMatch(/expired/i);
  });
});

describe("an expired hold", () => {
  it("says plainly that nothing was charged", () => {
    const state = guest("expired");
    expect(state.meaning).toMatch(/Nothing was charged/);
    expect(state.closed).toBe(true);
    expect(state.settled).toBe(true);
  });

  it("sends a guest back to the home, not back into a checkout", () => {
    expect(guest("expired").action).toEqual({ label: "See this home", to: "/listing/listing-1" });
  });
});

describe("a completed stay", () => {
  it("is not treated as settled, because a claim window may still be open", () => {
    // The deposit can still move after checkout. The escrow state says
    // whether it has, and it is rendered separately.
    expect(guest("completed").settled).toBe(false);
  });

  it("leads to the review, and changes the words once one is written", () => {
    expect(guest("completed", { review: { submitted: false, published: false } }).action).toEqual({
      label: "Write your review",
      to: "/review/booking-1",
    });
    const written = guest("completed", { review: { submitted: true, published: false } });
    expect(written.action?.label).toBe("See your review");
    expect(written.meaning).toMatch(/publishes when the other side/i);
  });

  it("says both are published only when the server says so", () => {
    const published = guest("completed", { review: { submitted: true, published: true } });
    expect(published.meaning).toMatch(/both reviews are published/i);
  });
});

describe("the same stay reads differently to each party", () => {
  it("does not tell a host to write the guest's review or find another home", () => {
    expect(host("canceled_by_guest").action).toBeNull();
    expect(host("expired").action).toBeNull();
  });

  it("attributes a cancellation to whoever made it", () => {
    expect(guest("canceled_by_host").meaning).toMatch(/The host canceled/);
    expect(host("canceled_by_host").meaning).toMatch(/You canceled/);
    expect(host("canceled_by_guest").meaning).toMatch(/The guest canceled/);
  });

  it("does not promise a refund amount it cannot know", () => {
    // The preview comes from the server; this copy only says a policy applied.
    for (const status of ["canceled_by_guest", "canceled_by_host"] as BookingStatus[]) {
      expect(guest(status).meaning).toMatch(/cancellation policy/i);
      expect(guest(status).meaning).not.toMatch(/\$/);
    }
  });
});

describe("grouping on the list", () => {
  it("puts an unconfirmed stay where it will be seen", () => {
    expect(tripGroup("pending_payment")).toBe("needs_attention");
    expect(TRIP_GROUP_LABEL.needs_attention).toBe("Not confirmed");
  });

  it("keeps live stays apart from finished ones", () => {
    expect(tripGroup("confirmed")).toBe("upcoming");
    expect(tripGroup("checked_in")).toBe("upcoming");
    expect(tripGroup("completed")).toBe("past");
    expect(tripGroup("expired")).toBe("past");
    expect(tripGroup("canceled_by_guest")).toBe("past");
    expect(tripGroup("canceled_by_host")).toBe("past");
  });
});
