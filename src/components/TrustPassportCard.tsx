import type { Passport } from "../lib/types";
import { formatMemberSince, initials, passportNumber, verificationLabel } from "../lib/passport";
import { StatusPill } from "./ui";

/**
 * The profile summary at the top of a member's page.
 *
 * This used to be a full-bleed identity card, complete with a machine-readable
 * strip and a border of claims — "member owned", "neutral escrow", "instant
 * payout", "issued by the members". None of those are things a profile can
 * assert, and the card swallowed the page that the actual evidence lives on.
 *
 * What is left is what can be substantiated: who this is, when they joined,
 * and which checks they have completed. The reference number is an identifier
 * for the record, not a credential — a passport here is a summary of history,
 * not a document anyone issued.
 */
export function TrustPassportCard({ passport }: { passport: Passport }) {
  const { stats, displayName, city, region, isHost } = passport;
  const place = [city, region].filter(Boolean).join(", ");
  const since = formatMemberSince(stats.memberSince);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <span
        aria-hidden
        className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-accent font-display text-2xl font-semibold text-brand"
      >
        {initials(displayName)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="m-0 text-[1.75rem] sm:text-page-title">{displayName}</h1>
        <p className="m-0 text-ink-secondary">
          {[since ? `Member since ${since}` : null, place || null].filter(Boolean).join(" · ") ||
            "No location on file"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={stats.verificationTier >= 2 ? "brand" : "neutral"}>
            {verificationLabel(stats.verificationTier)}
          </StatusPill>
          {isHost ? <StatusPill>Hosts a home</StatusPill> : null}
          <span className="money text-sm text-ink-secondary">
            Ref {passportNumber(passport.profileId)}
          </span>
        </div>
      </div>
    </div>
  );
}
