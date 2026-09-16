/**
 * HM-06 — what the street section decides before it draws anything.
 *
 * Pure, so these hold without tiles or a network: the style URL a fresh clone
 * gets, how close the map may sit when the pin was rounded, which sentence is
 * true about that rounding, and which of the three imagery states applies.
 */
import { describe, expect, it } from "vitest";
import { STREET_COPY } from "../src/lib/honestyCopy";
import { DEFAULT_MAP_STYLE_URL, mapStyleUrl, precisionNote, streetView, zoomFor } from "../src/lib/streetMap";

describe("which tiles this deployment uses", () => {
  it("needs no key or account out of the box", () => {
    expect(mapStyleUrl({})).toBe(DEFAULT_MAP_STYLE_URL);
    expect(mapStyleUrl({ VITE_MAP_STYLE_URL: "" })).toBe(DEFAULT_MAP_STYLE_URL);
    expect(DEFAULT_MAP_STYLE_URL).toMatch(/^https:/);
  });

  it("lets a deployment host or buy its own", () => {
    expect(mapStyleUrl({ VITE_MAP_STYLE_URL: "https://tiles.example.test/style.json" })).toBe(
      "https://tiles.example.test/style.json",
    );
  });
});

describe("how close the map may sit", () => {
  it("frames a rounded pin as a neighbourhood, not a doorstep", () => {
    expect(zoomFor({ exact: true, precisionM: 0 })).toBe(16);
    expect(zoomFor({ exact: false, precisionM: 150 })).toBe(14);
    // A coarser grid has to pull back further, or the frame overstates it.
    expect(zoomFor({ exact: false, precisionM: 500 })).toBe(12);
    expect(zoomFor({ exact: false, precisionM: 150 })).toBeLessThan(zoomFor({ exact: true, precisionM: 0 }));
  });
});

describe("what the guest is told about the pin", () => {
  it("names the distance rather than calling it approximate", () => {
    expect(precisionNote({ exact: false, precisionM: 150 }, STREET_COPY)).toBe(
      "Pin shown to the nearest 150 m until a stay is confirmed.",
    );
    expect(precisionNote({ exact: true, precisionM: 0 }, STREET_COPY)).toBe("Pin shows the front door.");
    // The vaguer word never appears on its own.
    expect(precisionNote({ exact: false, precisionM: 150 }, STREET_COPY)).toMatch(/\d+ m/);
  });
});

describe("which imagery state the section shows", () => {
  it("separates 'not for you yet' from 'nobody filmed this'", () => {
    expect(streetView({ hasApproach: true, exact: true })).toBe("approach");
    expect(streetView({ hasApproach: true, exact: false })).toBe("withheld");
    expect(streetView({ hasApproach: false, exact: false })).toBe("none");
    // Entitlement without footage is still nothing to show.
    expect(streetView({ hasApproach: false, exact: true })).toBe("none");
  });

  it("never offers to invent a façade", () => {
    expect(STREET_COPY.imagery.none).toContain("We do not draw what nobody filmed");
  });
});
