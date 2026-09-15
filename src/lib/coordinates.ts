/**
 * HM-01 — decimal-degree parsing for the front-door fields.
 *
 * Accepts what a host is likely to paste: "45.5231", "-122.6765",
 * "45.5231°", " 45,5231 " (a decimal comma). Refuses anything else. The
 * server re-validates ranges; this exists so the error sits next to the
 * field.
 */
export type CoordinateKind = "lat" | "lng";

const LIMIT: Record<CoordinateKind, number> = { lat: 90, lng: 180 };

export function parseCoordinate(raw: string, kind: CoordinateKind): number | null {
  const cleaned = raw.trim().replace(/°/g, "").replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || Math.abs(n) > LIMIT[kind]) return null;
  return n;
}

/** Six decimals is ~0.1 m; more is noise, fewer loses the door. */
export function formatCoordinate(n: number): string {
  return String(Number(n.toFixed(6)));
}

export type CoordinateErrors = Partial<Record<CoordinateKind, string>>;

export type CoordinatesResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; errors: CoordinateErrors };

export function validateCoordinates(latRaw: string, lngRaw: string): CoordinatesResult {
  const errors: CoordinateErrors = {};
  const lat = parseCoordinate(latRaw, "lat");
  const lng = parseCoordinate(lngRaw, "lng");
  if (lat === null) errors.lat = "Not a valid latitude. Use decimal degrees between -90 and 90.";
  if (lng === null) errors.lng = "Not a valid longitude. Use decimal degrees between -180 and 180.";
  if (lat === null || lng === null) return { ok: false, errors };
  return { ok: true, lat, lng };
}
