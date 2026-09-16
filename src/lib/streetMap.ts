/**
 * HM-06 — what the map needs decided before it loads (HM-D08).
 *
 * Pure, so the rules hold without tiles, a network or a GPU: which style URL
 * this deployment uses, how far out to sit when the pin has been rounded, and
 * which sentence is true about the precision the viewer was given.
 */
import type { ListingStreet } from "./types";

/**
 * OpenFreeMap by default (DECISIONS D08): OpenStreetMap data under ODbL, no
 * API key, no account, and its own terms permit production use — so a fresh
 * clone of Stead shows a map without anyone signing up for anything. A
 * deployment that would rather self-host the same style, or pay a vendor,
 * sets VITE_MAP_STYLE_URL and nothing else changes.
 */
export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function mapStyleUrl(env: Record<string, string | undefined> = import.meta.env): string {
  const configured = env.VITE_MAP_STYLE_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_MAP_STYLE_URL;
}

/**
 * How close the map may sit. A rounded pin is a claim about a neighbourhood,
 * so the zoom is capped: framing a 150 m cell as though it were a doorstep
 * would say something the data does not.
 */
export function zoomFor(street: Pick<ListingStreet, "exact" | "precisionM">): number {
  if (street.exact) return 16;
  return street.precisionM >= 500 ? 12 : 14;
}

/** The sentence under the map. Never "approximate" without the number. */
export function precisionNote(
  street: Pick<ListingStreet, "exact" | "precisionM">,
  copy: { pinExact: string; pinRounded: (metres: number) => string },
): string {
  return street.exact ? copy.pinExact : copy.pinRounded(street.precisionM);
}

/** What the street section should render, given what the server allowed. */
export type StreetView = "approach" | "withheld" | "none";

export function streetView(street: Pick<ListingStreet, "hasApproach" | "exact">): StreetView {
  if (!street.hasApproach) return "none";
  // Entitlement is the server's answer, and `exact` is how it arrives: a
  // viewer who may see the door is the viewer who may watch the approach.
  return street.exact ? "approach" : "withheld";
}
