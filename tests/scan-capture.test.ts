/**
 * HM-01. The capture client's pure helpers, and the hub's reading of the
 * server's state. Neither decides a verdict; both must agree with what the
 * server will demand so a button only lights up for a walk that can pass.
 */
import { describe, expect, it } from "vitest";
import {
  bookendReady,
  classifyFix,
  formatElapsed,
  hasCaptureSupport,
  phaseForStage,
  pickRecorderMimeType,
  toSample,
} from "../src/lib/scanCapture";
import { hubKind, rejectedReasonCopy, revokedReasonCopy, scanStatePill } from "../src/lib/scanHub";
import { HM } from "../src/lib/honesty";
import type { HostScan, HostScanRow, ScanLocationSample } from "../src/lib/types";

const NOW = Date.parse("2026-09-15T14:00:30Z");

function sample(secondsAgo: number, accuracyMeters: number, phase: ScanLocationSample["phase"] = "outdoor_start"): ScanLocationSample {
  return {
    recordedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
    lat: 40.7128,
    lng: -74.006,
    accuracyMeters,
    phase,
  };
}

describe("classifyFix", () => {
  it("is off when location is denied, whatever the last sample said", () => {
    expect(classifyFix(sample(1, 5), NOW, 25, "denied")).toBe("off");
  });
  it("is none without a sample or with a stale one", () => {
    expect(classifyFix(null, NOW, 25)).toBe("none");
    expect(classifyFix(sample(16, 5), NOW, 25)).toBe("none");
  });
  it("is good at or under the threshold and rough above it", () => {
    expect(classifyFix(sample(1, 25), NOW, 25)).toBe("good");
    expect(classifyFix(sample(1, 26), NOW, 25)).toBe("rough");
  });
});

describe("bookendReady", () => {
  it("needs the last N samples of the phase to be good and the newest fresh", () => {
    const good = [sample(3, 8), sample(2, 9), sample(1, 7)];
    expect(bookendReady(good, "outdoor_start", NOW, 25, 3)).toBe(true);
    expect(bookendReady(good.slice(1), "outdoor_start", NOW, 25, 3)).toBe(false);
    expect(bookendReady([sample(3, 8), sample(2, 40), sample(1, 7)], "outdoor_start", NOW, 25, 3)).toBe(false);
    expect(bookendReady([sample(30, 8), sample(20, 9), sample(16, 7)], "outdoor_start", NOW, 25, 3)).toBe(false);
  });
  it("only counts samples from the phase being finished", () => {
    const mixed = [sample(3, 8, "outdoor_start"), sample(2, 9, "outdoor_start"), sample(1, 7, "outdoor_start")];
    expect(bookendReady(mixed, "outdoor_end", NOW, 25, 3)).toBe(false);
  });
});

describe("phaseForStage", () => {
  it("stamps samples with the phase of the stage they arrive in, or drops them", () => {
    expect(phaseForStage("permissions")).toBeNull();
    expect(phaseForStage("outdoor_start")).toBe("outdoor_start");
    expect(phaseForStage("turn")).toBe("outdoor_start");
    expect(phaseForStage("indoor")).toBe("indoor");
    expect(phaseForStage("outdoor_end")).toBe("outdoor_end");
    expect(phaseForStage("finishing")).toBeNull();
    expect(phaseForStage("done")).toBeNull();
  });
});

describe("toSample", () => {
  it("rounds accuracy to whole metres and never below zero", () => {
    const s = toSample({ coords: { latitude: 1, longitude: 2, accuracy: 7.6 }, timestamp: NOW }, "indoor");
    expect(s).toEqual({ recordedAt: new Date(NOW).toISOString(), lat: 1, lng: 2, accuracyMeters: 8, phase: "indoor" });
    expect(toSample({ coords: { latitude: 1, longitude: 2, accuracy: -3 }, timestamp: NOW }, "indoor").accuracyMeters).toBe(0);
    expect(toSample({ coords: { latitude: 1, longitude: 2, accuracy: Number.NaN }, timestamp: NOW }, "indoor").accuracyMeters).toBe(100_000);
  });
});

describe("formatElapsed and the recorder type", () => {
  it("formats mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(61_000)).toBe("01:01");
    expect(formatElapsed(-5)).toBe("00:00");
  });
  it("prefers MP4, then WebM, and gives up honestly", () => {
    expect(pickRecorderMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickRecorderMimeType((t) => t === "video/mp4")).toBe("video/mp4");
    expect(pickRecorderMimeType(() => false)).toBeNull();
    expect(pickRecorderMimeType(() => { throw new Error("no"); })).toBeNull();
  });
  it("needs camera, location and a recorder", () => {
    expect(hasCaptureSupport({ mediaDevices: { getUserMedia: () => undefined }, geolocation: {} }, true)).toBe(true);
    expect(hasCaptureSupport({ mediaDevices: {}, geolocation: {} }, true)).toBe(false);
    expect(hasCaptureSupport({ mediaDevices: { getUserMedia: () => undefined } }, true)).toBe(false);
    expect(hasCaptureSupport({ mediaDevices: { getUserMedia: () => undefined }, geolocation: {} }, false)).toBe(false);
  });
});

function hub(overrides: { hasPin?: boolean; scan?: Partial<HostScanRow> | null }): HostScan {
  const base: HostScanRow = {
    id: "s1",
    state: "capturing",
    geofence: "pending",
    rejectReason: null,
    policyVersion: "1",
    thresholds: { accuracyMaxMeters: 25, geofenceRadiusMeters: 60, indoorToleranceMeters: 500, minSamples: 20, bookendMinSamples: 3, maxGapSeconds: 45, maxWalkMinutes: 20 },
    sampleCount: null,
    maxDistanceMeters: null,
    startedAt: null,
    finishedAt: null,
    locationCheckedAt: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: "2026-09-15T14:00:00.000Z",
  };
  return {
    listing: { id: "l1", title: "Gatehouse", type: "entire_home", status: "draft", hasPin: overrides.hasPin ?? true },
    policyVersion: "1",
    thresholds: base.thresholds,
    scan: overrides.scan === null ? null : { ...base, ...overrides.scan },
  };
}

describe("the hub reads only the server's state", () => {
  it("asks for the pin before anything else", () => {
    expect(hubKind(hub({ hasPin: false, scan: null }))).toBe("needs_pin");
    expect(scanStatePill(hub({ hasPin: false, scan: null }))).toEqual({ label: HM["hm.scan.state.needsPin"], tone: "neutral" });
  });
  it("names each state the way the doc does", () => {
    expect(hubKind(hub({ scan: null }))).toBe("not_started");
    expect(hubKind(hub({ scan: {} }))).toBe("in_progress");
    expect(hubKind(hub({ scan: { geofence: "passed" } }))).toBe("located");
    expect(scanStatePill(hub({ scan: { geofence: "passed" } })).label).toBe(HM["hm.scan.state.located"]);
    expect(hubKind(hub({ scan: { state: "rejected", geofence: "failed", rejectReason: "geofence" } }))).toBe("rejected");
    expect(scanStatePill(hub({ scan: { state: "rejected", geofence: "failed", rejectReason: "geofence" } })).tone).toBe("warning");
    expect(hubKind(hub({ scan: { state: "revoked", revokedReason: "pin_changed" } }))).toBe("revoked");
    expect(hubKind(hub({ scan: { state: "verified", geofence: "passed" } }))).toBe("later");
    expect(scanStatePill(hub({ scan: { state: "verified", geofence: "passed" } })).tone).toBe("brand");
  });
  it("never uses the danger tone for a scan state", () => {
    const states: HostScanRow["state"][] = ["capturing", "uploaded", "reconstructing", "needs_mask", "verified", "rejected", "failed", "revoked"];
    for (const state of states) {
      expect(scanStatePill(hub({ scan: { state } })).tone).not.toBe("danger");
    }
  });
  it("maps every reject reason to its sentence", () => {
    expect(rejectedReasonCopy("geofence")).toBe(HM["hm.rejected.geofence"]);
    expect(rejectedReasonCopy("samples")).toBe(HM["hm.rejected.samples"]);
    expect(rejectedReasonCopy("accuracy")).toBe(HM["hm.rejected.accuracy"]);
    expect(rejectedReasonCopy("bookends")).toBe(HM["hm.rejected.bookends"]);
    expect(revokedReasonCopy("pin_changed")).toBe(HM["hm.revoked.reason.pinChanged"]);
  });
});
