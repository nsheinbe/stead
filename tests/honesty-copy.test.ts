/**
 * HM-00 — the honesty-media copy is locked, and it stays honest.
 *
 * Three things this file protects:
 *  1. No banned verb (beautify, enhance, "live", court-grade …) and no
 *     platform-banned word appears in any honesty string, including the
 *     labels a future "disabled for later" control would reuse.
 *  2. The Soft Dist kill-switch copy is byte-for-byte what it was, and the
 *     scan refusal never matches the kill-switch regexes — the platform gate
 *     and the per-home gate must stay distinguishable in tests and support.
 *  3. The badge and disclosure keep their locked wording and never claim
 *     proof, GPS certainty or a legal record.
 */
import { describe, expect, it } from "vitest";
import { GUEST_BOOKINGS_CLOSED_MESSAGE } from "../server/lib/guestBookings";
import { BOOKINGS_CLOSED_COPY } from "../src/lib/guestBookings";
import {
  HONESTY_BADGE,
  HONESTY_CAPTURED,
  HONESTY_GUEST_DISCLOSURE,
  HONESTY_HOST_SHEET,
  HONESTY_MENTIONS,
  HONESTY_NEARBY,
  HONESTY_POLICY_VERSION,
  HONESTY_REFUSALS,
  HONESTY_VERBS,
  LOCATION_READOUT,
  PLATFORM_BANNED_WORDS,
  SCAN_REASON_COPY,
  SCAN_STATE_COPY,
  type ScanStateKey,
} from "../src/lib/honestyCopy";

/** Every user-facing string in the module, with template functions sampled. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (typeof value === "function") {
    // Templates take one argument: a formatted date, a city, a provider, or metres.
    const sample = (value as (arg: unknown) => unknown)("Sample");
    if (typeof sample === "string") out.push(sample);
    const numeric = (value as (arg: unknown) => unknown)(40);
    if (typeof numeric === "string") out.push(numeric);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out);
  }
  return out;
}

const SURFACES = {
  HONESTY_BADGE,
  HONESTY_GUEST_DISCLOSURE,
  HONESTY_CAPTURED,
  HONESTY_NEARBY,
  HONESTY_HOST_SHEET,
  SCAN_STATE_COPY,
  LOCATION_READOUT,
  HONESTY_REFUSALS,
  SCAN_REASON_COPY,
  HONESTY_MENTIONS,
  allowedVerbs: HONESTY_VERBS.allowed,
};

const ALL_STRINGS = collectStrings(SURFACES);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BANNED_VERBS = HONESTY_VERBS.banned.map((v) => new RegExp(`\\b${escapeRegExp(v)}\\b`, "i"));
const BANNED_PLATFORM = new RegExp(`\\b(${PLATFORM_BANNED_WORDS.map(escapeRegExp).join("|")})\\b`, "i");

describe("honesty copy — ban lists", () => {
  it("collected something to check", () => {
    expect(ALL_STRINGS.length).toBeGreaterThan(40);
  });

  it("contains no banned honesty verb, anywhere", () => {
    for (const s of ALL_STRINGS) {
      for (const re of BANNED_VERBS) {
        expect(s, `"${s}" matches ${re}`).not.toMatch(re);
      }
    }
  });

  it("contains no platform-banned word", () => {
    for (const s of ALL_STRINGS) {
      expect(s, `"${s}"`).not.toMatch(BANNED_PLATFORM);
    }
  });

  it("never claims certainty the scan cannot deliver", () => {
    const overclaim = /\b(proof|proves|proven beyond|guarantee|certified|tamper|court|legal record)\b/i;
    // "Geo-proven" is the badge term and is allowed; everything else that
    // sounds like a legal claim is not, except the disclosure's own
    // sentence that says it is *not* proof.
    for (const s of ALL_STRINGS) {
      const allowed = /geo-proven/i.test(s) || /not proof|not a legal record/i.test(s);
      if (allowed) continue;
      expect(s, `"${s}"`).not.toMatch(overclaim);
    }
  });
});

describe("honesty copy — locked strings", () => {
  it("locks the badge", () => {
    expect(HONESTY_BADGE.short).toBe("Geo-proven walkthrough");
    expect(HONESTY_BADGE.full).toBe(
      "Geo-proven walkthrough · Captured by the host · Stitched, not invented",
    );
    expect(HONESTY_BADGE.full.startsWith(HONESTY_BADGE.short)).toBe(true);
  });

  it("keeps the guest disclosure's three load-bearing claims", () => {
    const text = HONESTY_GUEST_DISCLOSURE.paragraphs.join(" ");
    expect(text).toMatch(/never their route/);
    expect(text).toMatch(/never add rooms, furniture, windows or views/);
    expect(text).toMatch(/not proof against every trick/);
    expect(text).toMatch(/not a legal record/);
  });

  it("captured-on is a date line, never a liveness claim", () => {
    expect(HONESTY_CAPTURED.capturedOn("14 Sep 2026")).toBe("Captured 14 Sep 2026");
    expect(HONESTY_CAPTURED.hint).toMatch(/time zone/);
  });

  it("every host scan state has one label, one tone and one next action", () => {
    const keys: ScanStateKey[] = [
      "not_started",
      "needs_location",
      "capturing",
      "uploading",
      "uploaded",
      "reconstructing",
      "needs_mask",
      "verified",
      "rejected",
      "failed",
    ];
    for (const key of keys) {
      const entry = SCAN_STATE_COPY[key];
      const label = typeof entry.label === "function" ? entry.label("14 Sep 2026") : entry.label;
      expect(label.length).toBeGreaterThan(0);
      expect(["neutral", "warning", "brand"]).toContain(entry.tone);
      expect(HONESTY_VERBS.allowed).toContain(entry.action);
    }
    // Failure is never the claim / dispute tone.
    expect(SCAN_STATE_COPY.rejected.tone).not.toBe("danger");
    expect(SCAN_STATE_COPY.failed.tone).not.toBe("danger");
  });

  it("rounds the location readout to 5 m and never invents a fix", () => {
    expect(LOCATION_READOUT.good(8)).toBe("Location: good (about 10 m)");
    expect(LOCATION_READOUT.rough(62)).toMatch(/^Location: rough \(about 60 m\)\./);
    expect(LOCATION_READOUT.good(-3)).toBe("Location: good (about 0 m)");
    expect(LOCATION_READOUT.good(Number.NaN)).toBe("Location: good (about 0 m)");
    expect(LOCATION_READOUT.waiting).toMatch(/waiting for your phone/);
  });

  it("pins the policy version HM-02 will snapshot", () => {
    expect(HONESTY_POLICY_VERSION).toBe(1);
  });

  it("host sheet says bookings need a verified scan and that it is separate from payouts and the platform switch", () => {
    const bookings = HONESTY_HOST_SHEET.sections.find((s) => s.heading === "Bookings.");
    expect(bookings?.body).toMatch(/cannot book this home until a scan is verified/);
    expect(bookings?.body).toMatch(/separate from payouts/);
    expect(bookings?.body).toMatch(/separate from Stead opening guest bookings/);
    expect(HONESTY_HOST_SHEET.start).toBe("Start the walk");
  });

  it("nearby copy never fills an empty city", () => {
    expect(HONESTY_NEARBY.empty("Lisbon")).toBe("No homes on Stead in Lisbon yet.");
    expect(HONESTY_NEARBY.explainer).toMatch(/Nothing on this map is generated/);
    expect(HONESTY_NEARBY.imagery.none).toMatch(/do not draw what nobody filmed/);
  });
});

describe("honesty copy — the two gates stay distinguishable", () => {
  it("leaves the Soft Dist kill-switch copy byte-for-byte", () => {
    expect(BOOKINGS_CLOSED_COPY.title).toBe("Not open for bookings yet");
    expect(BOOKINGS_CLOSED_COPY.body).toBe(
      "Guest stays aren't live yet. You can still read the home and message the host.",
    );
    expect(GUEST_BOOKINGS_CLOSED_MESSAGE).toBe("Bookings aren't open yet.");
  });

  it("scan refusals never match the kill-switch regexes used by tests/guest-bookings.test.ts", () => {
    for (const message of Object.values(HONESTY_REFUSALS)) {
      expect(message).not.toMatch(/not open for bookings yet/i);
      expect(message).not.toMatch(/aren't open yet/i);
    }
    expect(HONESTY_REFUSALS.bookingNotVerified).toMatch(/honesty scan hasn't been verified/);
    expect(HONESTY_REFUSALS.publishNotVerified).toMatch(/verified honesty scan before it can be published/);
  });

  it("the one-line mentions say scan, not bookings-on", () => {
    expect(HONESTY_MENTIONS.forHomeownersFaq.q).toBe("What is the honesty scan?");
    expect(HONESTY_MENTIONS.forHomeownersFaq.a).toMatch(/we never invent rooms/);
    expect(HONESTY_MENTIONS.forHomeownersStep).toMatch(/walk-scan your home/);
    expect(HONESTY_MENTIONS.hostStartSetup).toMatch(/before guests can book/);
    for (const s of collectStrings(HONESTY_MENTIONS)) {
      expect(s).not.toMatch(/bookings are open|book now|reserve now/i);
    }
  });
});
