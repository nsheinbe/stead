import type { Passport } from "../lib/types";
import {
  formatMemberSince,
  formatPct,
  formatRating,
  initials,
  mrzLine,
  passportNumber,
} from "../lib/passport";

function Guilloche() {
  return (
    <svg
      width="170"
      height="170"
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -right-12 top-8"
      aria-hidden
    >
      <g fill="none" stroke="#B58B3E" strokeWidth="0.55" opacity="0.5">
        <ellipse cx="100" cy="100" rx="96" ry="32" />
        <ellipse cx="100" cy="100" rx="96" ry="32" transform="rotate(30 100 100)" />
        <ellipse cx="100" cy="100" rx="96" ry="32" transform="rotate(60 100 100)" />
        <ellipse cx="100" cy="100" rx="96" ry="32" transform="rotate(90 100 100)" />
        <ellipse cx="100" cy="100" rx="96" ry="32" transform="rotate(120 100 100)" />
        <ellipse cx="100" cy="100" rx="96" ry="32" transform="rotate(150 100 100)" />
        <circle cx="100" cy="100" r="58" />
      </g>
    </svg>
  );
}

function Stat({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="money text-[19px] font-bold leading-none">{value}</span>
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink/70">{label}</span>
    </div>
  );
}

function ShieldMark() {
  return (
    <svg width="9" height="11" viewBox="0 0 15 17" fill="none" aria-hidden>
      <path
        d="M7.5 1 L14 3.5 V8 C14 12.5 11.2 15 7.5 16 C3.8 15 1 12.5 1 8 V3.5 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M4.8 8.2 L6.8 10.2 L10.4 6.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrustPassportCard({ passport }: { passport: Passport }) {
  const { stats, displayName, isHost, city, region } = passport;
  const number = passportNumber(passport.profileId);
  const place = [city, region].filter(Boolean).join(", ");
  const since = formatMemberSince(stats.memberSince);
  const location = [since ? `Member since ${since}` : null, place].filter(Boolean).join(" · ");

  return (
    <article
      className="relative overflow-hidden rounded-card border border-brass/60 bg-[#F8F3E9] text-ink shadow-[0_20px_44px_rgba(0,0,0,.35)]"
      aria-label="Trust Passport"
    >
      <Guilloche />
      <div aria-hidden className="overflow-hidden whitespace-nowrap border-b border-brass/35 py-1.5 text-center text-[5.5px] font-bold tracking-[0.3em] text-spruce">
        TRUST PASSPORT · MEMBER OWNED · PORTABLE REPUTATION · NEUTRAL ESCROW · TRUST PASSPORT · MEMBER OWNED
      </div>
      <div className="relative flex flex-col gap-3.5 px-[18px] py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10.5px] font-bold tracking-[0.22em] text-spruce">TRUST PASSPORT</span>
          <span className="money text-[11px] font-semibold tracking-[0.06em] text-brass-deep">Nº {number}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-brass bg-spruce font-display text-[22px] font-semibold text-[#F8F3E9] outline outline-1 outline-offset-[3px] outline-brass/45">
            {initials(displayName)}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-display text-[23px] font-semibold leading-none">{displayName}</span>
            {location ? <span className="text-[11.5px] text-ink/70">{location}</span> : null}
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-accent px-2.5 py-1 text-[10.5px] font-bold text-brand">
              <ShieldMark />
              Tier {stats.verificationTier} verified
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
          <Stat value={String(stats.staysCompleted)} label="Stays" />
          <Stat value={String(stats.damageFreeStreak)} label="Damage-free" />
          <Stat
            value={String(stats.hostCancellations)}
            label="Host cancels"
            testId="host-cancellations"
          />
          <Stat value={`${formatRating(stats.avgRatingAsGuest)} ★`} label="As guest" />
          <Stat value={`${formatRating(stats.avgRatingAsHost)} ★`} label="As host" />
          <Stat value={formatPct(stats.responseRate)} label="Response" />
        </div>
        <div
          aria-hidden
          className="overflow-hidden whitespace-pre rounded-md bg-spruce/[0.07] px-3 py-2 font-money text-[9.5px] leading-relaxed tracking-[0.14em] text-spruce"
        >
          {mrzLine(displayName, number, stats.staysCompleted, stats.hostCancellations)}
        </div>
        {isHost ? (
          <span className="sr-only">This member also hosts.</span>
        ) : null}
      </div>
      <div aria-hidden className="overflow-hidden whitespace-nowrap border-t border-brass/35 py-1.5 text-center text-[5.5px] font-bold tracking-[0.3em] text-spruce">
        ISSUED BY THE MEMBERS · REVIEWS WITH RECEIPTS · INSTANT PAYOUT · INDEPENDENT ARBITRATION
      </div>
    </article>
  );
}
