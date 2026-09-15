/** HM-02 — the location record as the server reads it: samples and clocks, never a verdict. */
import { describe, expect, it } from "vitest";
import { capturedOnFor, parseAttestation } from "../server/lib/attestation";

const SCAN = "4a2e0c9a-2222-4222-8222-222222222222";
const LISTING = "3f1e0c9a-1111-4111-8111-111111111111";

const good = {
  version: 1,
  scanId: SCAN,
  listingId: LISTING,
  policyVersion: 1,
  recording: { startedAt: "2026-09-14T23:30:00Z", durationMs: 240_000, mimeType: "video/mp4" },
  samples: [
    { t: 0, lat: 42.2529, lng: -73.791, acc: 8 },
    { t: 1000, lat: 42.2529, lng: -73.791, acc: 9 },
  ],
  pauses: [{ fromMs: 60_000, toMs: 61_000 }],
  client: { userAgent: "UA", platform: "iOS" },
};

describe("parseAttestation", () => {
  it("keeps samples and clocks and drops anything that looks like a verdict", () => {
    const text = JSON.stringify({
      ...good,
      verified: true,
      geofence: { ok: true, atHome: true },
      samples: good.samples.map((s) => ({ ...s, cleared: true, atHome: true })),
      recording: { ...good.recording, verifiedBy: "gps" },
    });
    const result = parseAttestation(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.attestation as unknown as Record<string, unknown>;
    expect("verified" in a).toBe(false);
    expect("geofence" in a).toBe(false);
    expect(Object.keys(result.attestation.samples[0] ?? {}).sort()).toEqual(["acc", "lat", "lng", "t"]);
    expect("verifiedBy" in result.attestation.recording).toBe(false);
    expect(result.attestation.pauses).toEqual(good.pauses);
    expect(result.attestation.client).toEqual({ userAgent: "UA", platform: "iOS" });
  });

  it("refuses what it cannot read", () => {
    expect(parseAttestation("not json").ok).toBe(false);
    expect(parseAttestation(JSON.stringify({ ...good, version: 2 })).ok).toBe(false);
    expect(parseAttestation(JSON.stringify({ ...good, scanId: "nope" })).ok).toBe(false);
    expect(parseAttestation(JSON.stringify({ ...good, samples: [{ t: -1, lat: 0, lng: 0, acc: 1 }] })).ok).toBe(false);
    expect(parseAttestation(JSON.stringify({ ...good, samples: [{ t: 0, lat: 91, lng: 0, acc: 1 }] })).ok).toBe(false);
    expect(parseAttestation(JSON.stringify({ ...good, recording: { ...good.recording, startedAt: "yesterday" } })).ok).toBe(
      false,
    );
  });

  it("defaults the optional client and pauses", () => {
    const { pauses: _p, client: _c, ...minimal } = good;
    const result = parseAttestation(JSON.stringify(minimal));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attestation.pauses).toEqual([]);
      expect(result.attestation.client).toEqual({ userAgent: "", platform: null });
    }
  });
});

describe("capturedOnFor", () => {
  it("is the listing-local calendar date of the first frame", () => {
    expect(capturedOnFor("2026-09-14T23:30:00Z", "America/Los_Angeles")).toBe("2026-09-14");
    expect(capturedOnFor("2026-09-14T23:30:00Z", "Asia/Tokyo")).toBe("2026-09-15");
    expect(capturedOnFor("2026-09-15T03:30:00+01:00", "Europe/Lisbon")).toBe("2026-09-15");
  });
});
