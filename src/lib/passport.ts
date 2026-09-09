/** Display helpers for the Trust Passport card. Shared by the page and tests. */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function passportNumber(profileId: string): string {
  const hex = profileId.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `TP-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatRating(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

export function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function mrzLine(displayName: string, number: string, stays: number, cancels: number): string {
  const parts = displayName.trim().toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/);
  const last = parts[parts.length - 1] ?? "MEMBER";
  const first = parts[0] ?? "MEMBER";
  const name = `P<STEAD<<${last}<<${first}`.padEnd(36, "<").slice(0, 36);
  const code = number.replaceAll("-", "").replace("TP", "TP");
  return `${name}\n${code}<${String(stays).padStart(2, "0")}STAYS<${cancels}CANCEL<`;
}
