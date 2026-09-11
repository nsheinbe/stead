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

/**
 * What a verification tier actually asserts.
 *
 * A tier is a record of which checks a member completed, not a safety
 * guarantee, and the wording keeps that distinction. Anything above the tiers
 * the backend issues is reported as unknown rather than guessed at.
 */
export function verificationLabel(tier: number): string {
  switch (tier) {
    case 0:
      return "Email verified";
    case 1:
      return "Phone verified";
    case 2:
      return "Government ID verified";
    default:
      return tier > 2 ? `Verification tier ${tier}` : "Not verified";
  }
}

export function verificationDetail(tier: number): string {
  switch (tier) {
    case 0:
      return "This member confirmed an email address. No identity document has been checked.";
    case 1:
      return "This member confirmed a phone number. No identity document has been checked.";
    case 2:
      return "Stripe checked a government ID for this member.";
    default:
      return "We don't have a verification record for this member.";
  }
}

/**
 * A statistic, or an honest absence.
 *
 * A member with no completed stays has no average rating — which is not the
 * same as a rating of zero, and must never render as one.
 */
export function statOrAbsent(value: number | null, format: (n: number) => string): string {
  return value == null ? "Not enough activity yet" : format(value);
}
