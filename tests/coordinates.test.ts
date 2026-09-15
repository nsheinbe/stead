/** HM-01 — decimal-degree parsing for the front-door fields. */
import { describe, expect, it } from "vitest";
import { formatCoordinate, parseCoordinate, validateCoordinates } from "../src/lib/coordinates";

describe("parseCoordinate", () => {
  it("accepts decimal degrees in the ways people paste them", () => {
    expect(parseCoordinate("45.5231", "lat")).toBe(45.5231);
    expect(parseCoordinate(" -122.6765 ", "lng")).toBe(-122.6765);
    expect(parseCoordinate("45,5231", "lat")).toBe(45.5231);
    expect(parseCoordinate("45.5231°", "lat")).toBe(45.5231);
    expect(parseCoordinate("+7", "lng")).toBe(7);
  });

  it("refuses anything that is not a coordinate in range", () => {
    expect(parseCoordinate("", "lat")).toBeNull();
    expect(parseCoordinate("north", "lat")).toBeNull();
    expect(parseCoordinate("91", "lat")).toBeNull();
    expect(parseCoordinate("-181", "lng")).toBeNull();
    expect(parseCoordinate("45.5.1", "lat")).toBeNull();
    expect(parseCoordinate("1e3", "lng")).toBeNull();
    expect(parseCoordinate("45° 31' 23\"", "lat")).toBeNull();
  });
});

describe("formatCoordinate", () => {
  it("keeps six decimals and drops trailing noise", () => {
    expect(formatCoordinate(45.523100001)).toBe("45.5231");
    expect(formatCoordinate(-122.67654321)).toBe("-122.676543");
    expect(formatCoordinate(0)).toBe("0");
  });
});

describe("validateCoordinates", () => {
  it("reports each field's problem beside the field", () => {
    const bad = validateCoordinates("x", "200");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.lat).toMatch(/latitude/);
      expect(bad.errors.lng).toMatch(/longitude/);
    }
    const good = validateCoordinates("42.2529", "-73.791");
    expect(good).toEqual({ ok: true, lat: 42.2529, lng: -73.791 });
  });
});
