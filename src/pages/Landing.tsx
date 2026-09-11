import { useState } from "react";
import { Link } from "react-router-dom";
import { FeeCompare } from "../components/FeeCompare";
import { Shell } from "../components/Shell";
import { TrustPassportCard } from "../components/TrustPassportCard";
import { formatUsd } from "../lib/money";
import type { Passport } from "../lib/types";

const HERO_IMG = "https://picsum.photos/seed/stead-hero-home/1600/1000";
const HOST_IMG = "https://picsum.photos/seed/stead-host-door/900/1200";

const DEMO_PASSPORT: Passport = {
  profileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  displayName: "Nora Bennett",
  avatarUrl: null,
  isHost: true,
  city: "Hudson",
  region: "NY",
  stats: {
    profileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    staysCompleted: 21,
    damageFreeStreak: 21,
    avgRatingAsGuest: 4.93,
    avgRatingAsHost: 4.88,
    reviewCount: 34,
    responseRate: 0.98,
    hostCancellations: 0,
    verificationTier: 2,
    memberSince: "2023-03-01T00:00:00.000Z",
  },
  reviews: [],
};

const ESCROW_STEPS = [
  {
    t: "Held at check-in",
    d: "Your deposit moves into neutral escrow at listing-local check-in — not the host's account, not ours.",
    status: "$300 · held in neutral escrow",
  },
  {
    t: "During the stay",
    d: "It sits there, untouchable. By anyone. Including us.",
    status: "$300 · in escrow — nobody can touch it",
  },
  {
    t: "48-hour claim window",
    d: "After checkout, the host has 48 hours to file a claim — with photos.",
    status: "$300 · claim window closes in 41 h",
  },
  {
    t: "Auto-released",
    d: "No claim? Back on your card instantly. Not eventually.",
    status: "$300 · back on the guest's card",
  },
] as const;

const FAQ = [
  {
    q: "Is my money safe?",
    a: "Stay payments and deposits sit with a regulated payment partner, in accounts neither the host nor we can move unilaterally. Money moves only by the rules both parties agreed to at booking — on time, every time.",
  },
  {
    q: "What if a guest damages my home?",
    a: "File a claim within 48 hours of checkout, with photos. If the guest accepts, you're paid from the deposit instantly. If they dispute, independent arbitration decides — usually within five days.",
  },
  {
    q: "What happens in a dispute?",
    a: "Both sides submit evidence to independent arbitrators. Each party sees the identical file — no back channels, no support-ticket roulette. The decision is binding and executes automatically.",
  },
  {
    q: "Why is the fee only 2%?",
    a: "Because 2% covers what the network actually costs: payments, verification, and arbitration. There are no shareholders to feed. Members own it, so the price is the cost.",
  },
  {
    q: "How is identity verified?",
    a: "Tier 0 is email. Tier 1 adds a verified phone. Tier 2 adds a government ID. Your tier is stamped on your Trust Passport — and hosts can see it before they accept.",
  },
] as const;

const REVIEWS = [
  {
    initials: "MR",
    name: "Maya R.",
    meta: "30 nights · Hudson, NY · June 2026",
    body: "The house smells like cedar and the coffee was where the listing said it would be. Checkout took four minutes, and the deposit was back before our flight boarded.",
    receipt: "S-49213",
    tag: "Double-blind",
    stars: 5,
    ink: false,
  },
  {
    initials: "TP",
    name: "Tom & Priya S.",
    meta: "30 nights · Asheville, NC · May 2026",
    body: "Thirty nights for the price the search page showed. No fee reveal at checkout — which honestly felt like a typo. It wasn't.",
    receipt: "S-48771",
    tag: "Double-blind",
    stars: 5,
    ink: false,
  },
  {
    initials: "NB",
    name: "Nora B. — host",
    meta: "Reviewed her guest · April 2026",
    body: "Left the place tidier than the photos. Streak intact — mine and theirs. Would hand them the keys again without thinking.",
    receipt: "S-47102",
    tag: "Host → guest",
    stars: 4,
    ink: true,
  },
] as const;

function Wave() {
  return (
    <div className="bg-paper px-6 lg:px-16" aria-hidden>
      <svg width="100%" height="22" viewBox="0 0 1200 22" preserveAspectRatio="none" className="block">
        <path
          d="M0 11 Q30 1 60 11 T120 11 T180 11 T240 11 T300 11 T360 11 T420 11 T480 11 T540 11 T600 11 T660 11 T720 11 T780 11 T840 11 T900 11 T960 11 T1020 11 T1080 11 T1140 11 T1200 11"
          fill="none"
          stroke="#B58B3E"
          strokeWidth="0.9"
          opacity="0.4"
        />
        <path
          d="M0 11 Q30 21 60 11 T120 11 T180 11 T240 11 T300 11 T360 11 T420 11 T480 11 T540 11 T600 11 T660 11 T720 11 T780 11 T840 11 T900 11 T960 11 T1020 11 T1080 11 T1140 11 T1200 11"
          fill="none"
          stroke="#B58B3E"
          strokeWidth="0.9"
          opacity="0.26"
        />
      </svg>
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 shrink-0">
      <path d="M2 8.5 L6 12.5 L14 3.5" stroke="#DDB672" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5" role="img" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width="17" height="16" viewBox="0 0 17 16" aria-hidden>
          <path
            d="M8.5 0.8 L10.6 5.6 L15.8 6.1 L11.9 9.6 L13 14.7 L8.5 12.1 L4 14.7 L5.1 9.6 L1.2 6.1 L6.4 5.6 Z"
            fill={i < count ? "#B58B3E" : "rgba(181,139,62,.28)"}
          />
        </svg>
      ))}
    </div>
  );
}

export function LandingPage() {
  const [escrow, setEscrow] = useState(0);
  const hostExample = 18000 * 30;

  return (
    <Shell width="full">
        <section className="relative min-h-[520px] md:h-[740px]" aria-labelledby="hero-heading">
          <img src={HERO_IMG} alt="A lived-in home in morning light" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/40 to-transparent" />
          <div className="relative z-10 flex h-full flex-col justify-end gap-10 px-5 pb-12 pt-24 md:flex-row md:items-end md:justify-between md:px-16 md:pb-[60px]">
            <div className="flex max-w-[830px] flex-col gap-[22px]">
              <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-light">
                Member-owned home rentals
              </p>
              <h1
                id="hero-heading"
                className="m-0 font-display text-[42px] font-bold leading-[1.04] tracking-tight text-paper md:text-[66px]"
              >
                Stay in homes. Skip the toll booth.
              </h1>
              <p className="m-0 max-w-[620px] text-[17px] leading-relaxed text-paper/88 md:text-[19px]">
                A home rental network owned by its members. A flat 2% fee you can check by hand, deposits held in
                neutral escrow, and a reputation that belongs to you — not to a platform.
              </p>
              <div className="mt-2 flex flex-wrap gap-3.5">
                <Link
                  to="/explore"
                  className="inline-flex items-center rounded-xl bg-paper px-[30px] py-4 text-[16.5px] font-bold text-ink no-underline shadow-[0_10px_28px_rgba(23,32,27,.38)] hover:bg-linen hover:text-ink"
                >
                  Find a stay
                </Link>
                <a
                  href="#hosts"
                  className="inline-flex items-center rounded-xl border-[1.5px] border-paper/65 px-[30px] py-4 text-[16.5px] font-semibold text-paper no-underline hover:bg-paper/10 hover:text-paper"
                >
                  List your place
                </a>
              </div>
            </div>
            <div
              className="flex h-[152px] w-[152px] shrink-0 rotate-[7deg] flex-col items-center justify-center gap-0.5 rounded-full border-[1.5px] border-paper/85 text-paper outline outline-1 outline-offset-[5px] outline-paper/38"
              aria-hidden
            >
              <span className="font-display text-[46px] font-bold leading-none">2%</span>
              <span className="text-[9.5px] font-bold tracking-[0.24em]">FLAT · FOREVER</span>
            </div>
          </div>
        </section>

        <section id="math" className="flex flex-col gap-[52px] bg-paper px-5 py-16 md:px-16 md:py-[108px]" aria-labelledby="math-heading">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-deep">The math, in the open</p>
            <h2 id="math-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              Same stay. Different arithmetic.
            </h2>
            <p className="m-0 max-w-[560px] text-[17.5px] leading-relaxed text-ink/62">
              Drag the sliders — the difference isn't subtle. Every price in the product shows this working. Stays are
              30 nights or more.
            </p>
          </div>
          <FeeCompare />
        </section>

        <Wave />

        <section id="deposits" className="flex flex-col gap-11 bg-paper px-5 py-16 md:px-16 md:py-[108px]" aria-labelledby="deposit-heading">
          <div className="flex max-w-[900px] flex-col gap-4">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-deep">Deposits done right</p>
            <h2 id="deposit-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              Your deposit isn't ours to keep. It isn't theirs either.
            </h2>
            <p className="m-0 max-w-[680px] text-[17.5px] leading-relaxed text-ink/62">
              A $300 incidentals deposit rides along with every booking — held in neutral escrow, moved only by rules
              both of you agreed to. Click through its life:
            </p>
          </div>
          <div className="flex flex-col gap-10 rounded-card bg-linen px-6 py-10 shadow-card md:px-12">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex flex-wrap gap-2.5" role="tablist" aria-label="Deposit life">
                {ESCROW_STEPS.map((step, i) => (
                  <button
                    key={step.t}
                    type="button"
                    role="tab"
                    aria-selected={escrow === i}
                    onClick={() => setEscrow(i)}
                    className={`min-h-11 whitespace-nowrap rounded-[10px] px-[18px] py-[11px] text-[14.5px] font-semibold ${
                      escrow === i
                        ? "bg-spruce text-paper"
                        : "border border-[#D8CDB6] bg-paper/65 text-ink"
                    }`}
                  >
                    {step.t}
                  </button>
                ))}
              </div>
              <span
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[15px] font-semibold ${
                  escrow === 3
                    ? "bg-spruce text-paper"
                    : "border border-brass/50 bg-brass/16 text-ink"
                }`}
              >
                {ESCROW_STEPS[escrow]!.status}
              </span>
            </div>
            <div className="relative">
              <div className="absolute left-[11px] right-[11px] top-2.5 h-[3px] rounded-full bg-[#DFD5BE]" />
              <div
                className="absolute left-[11px] top-2.5 h-[3px] rounded-full bg-spruce motion-safe:transition-[width] motion-safe:duration-500"
                style={{ width: ["4%", "36%", "68%", "100%"][escrow] }}
              />
              <div className="relative grid gap-7 md:grid-cols-4">
                {ESCROW_STEPS.map((step, i) => {
                  const done = i <= escrow;
                  const current = i === escrow;
                  return (
                    <div key={step.t} className="flex flex-col gap-3.5">
                      <span
                        className={`relative z-[2] box-border h-[22px] w-[22px] rounded-full border-2 ${
                          done ? "border-spruce bg-spruce" : "border-[#CFC5AC] bg-paper"
                        } ${current ? "shadow-[0_0_0_3px_#EFE9DF,0_0_0_5px_#B58B3E]" : ""}`}
                      />
                      <div className={`text-[16.5px] font-bold ${done ? "text-ink" : "text-ink/42"}`}>{step.t}</div>
                      <p className="m-0 max-w-[270px] text-[14.5px] leading-relaxed text-ink/62">{step.d}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="m-0 max-w-[880px] border-t border-[#E2D8C2] pt-6 text-[15px] leading-relaxed text-ink/62">
              Claims require photo evidence. Dispute one, and it goes to independent arbitration — both sides see the
              identical file, the decision is binding, and it executes automatically.
            </p>
          </div>
        </section>

        <section
          id="passport"
          className="grid items-center gap-11 bg-spruce px-5 py-16 text-paper lg:grid-cols-[minmax(0,400px)_minmax(0,560px)_minmax(0,300px)] lg:px-16 lg:py-[108px]"
          aria-labelledby="passport-heading"
        >
          <div className="flex flex-col gap-5">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-light">
              Reputation you own
            </p>
            <h2 id="passport-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              One passport. Every door.
            </h2>
            <p className="m-0 text-[17px] leading-relaxed text-paper/75">
              Your verified identity and earned reputation live in a Trust Passport that belongs to you — not to a
              platform's database.
            </p>
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
              <li className="flex items-start gap-3 text-base text-paper/90">
                <CheckMark />
                <span>
                  <b>Portable</b> — it travels with you, host or guest, city to city.
                </span>
              </li>
              <li className="flex items-start gap-3 text-base text-paper/90">
                <CheckMark />
                <span>
                  <b>Permanent</b> — no corporation can delete it. Ever.
                </span>
              </li>
              <li className="flex items-start gap-3 text-base text-paper/90">
                <CheckMark />
                <span>
                  <b>Two-sided</b> — you carry ratings as a guest and as a host.
                </span>
              </li>
            </ul>
          </div>
          <TrustPassportCard passport={DEMO_PASSPORT} />
          <div className="flex flex-col gap-11">
            {[
              ["Verification tier", "Tier 2 is a government ID. Email is the start; phone is tier 1."],
              ["Damage-free streak", "21 stays, zero deductions. Hosts read this first."],
              ["Rated both ways", "Guest score and host score, on one document."],
              ["Host cancellations", "Shown in the open. A host who cancels on you cannot hide it."],
            ].map(([title, body]) => (
              <div key={title} className="flex items-start gap-3.5">
                <div className="mt-2.5 h-px w-11 shrink-0 bg-brass" />
                <div className="flex flex-col gap-1">
                  <span className="text-[15.5px] font-bold">{title}</span>
                  <span className="text-[13.5px] leading-relaxed text-paper/65">{body}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-[52px] bg-paper px-5 py-16 md:px-16 md:py-[108px]" aria-labelledby="reviews-heading">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-deep">Reviews with receipts</p>
            <h2 id="reviews-heading" className="m-0 max-w-[720px] font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              Reviews that can't be bought, buried, or deleted.
            </h2>
            <p className="m-0 max-w-[620px] text-[17.5px] leading-relaxed text-ink/62">
              Double-blind, written only from completed paid stays, tied to a booking receipt, permanent once published.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {REVIEWS.map((review) => (
              <article
                key={review.receipt}
                className="flex flex-col gap-[18px] rounded-card border border-[#E5DDCA] bg-paper p-[30px] shadow-card"
              >
                <Stars count={review.stars} />
                <p className="m-0 text-base leading-relaxed text-ink/85">“{review.body}”</p>
                <div className="mt-auto flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold ${
                      review.ink ? "bg-spruce text-paper" : "bg-linen text-spruce"
                    }`}
                  >
                    {review.initials}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[15px] font-bold">{review.name}</span>
                    <span className="text-[13.5px] text-ink/70">{review.meta}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-linen px-2.5 py-1.5 text-[12.5px] font-semibold">
                    Verified stay · Receipt #{review.receipt}
                  </span>
                  <span className="rounded-full border border-[#DDD3BE] px-2.5 py-1.5 text-[12.5px] font-semibold text-ink/65">
                    {review.tag}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="hosts"
          className="grid items-center gap-12 bg-linen px-5 py-16 lg:grid-cols-[1fr_480px] lg:px-16 lg:py-[108px]"
          aria-labelledby="hosts-heading"
        >
          <div className="flex flex-col gap-[22px]">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-spruce">For hosts</p>
            <h2 id="hosts-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              Paid at check-in. Not in 3–5 business days.
            </h2>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              <li className="text-[16.5px] leading-relaxed text-ink/85">
                <b>Instant payout</b> — your money lands the moment your guest checks in.
              </li>
              <li className="text-[16.5px] leading-relaxed text-ink/85">
                <b>Keep 100% of your rate</b> — the flat 2% rides on top, on the guest's side of the receipt.
              </li>
              <li className="text-[16.5px] leading-relaxed text-ink/85">
                <b>Claims you can read</b> — 48-hour window, photo evidence, independent arbitration. The rulebook is
                public.
              </li>
            </ul>
            <div className="mt-2 flex flex-col justify-between gap-6 rounded-card bg-paper px-[30px] py-[26px] shadow-card md:flex-row md:items-center">
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-ink/70">A month in August</span>
                <span className="money text-2xl font-bold">{formatUsd(18000)} × 30 nights = {formatUsd(hostExample)}</span>
                <span className="money text-sm text-ink/65">
                  Elsewhere: ≈ {formatUsd(hostExample - Math.trunc((hostExample * 300) / 10_000))} after host
                  fees, days later.
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="money text-[28px] font-bold text-spruce">{formatUsd(hostExample)}</span>
                <span className="inline-flex items-center rounded-full bg-spruce px-3 py-1.5 text-[12.5px] font-bold text-paper">
                  at check-in
                </span>
              </div>
            </div>
            <div className="mt-2">
              <Link
                to="/host/listings"
                className="inline-flex items-center rounded-xl bg-spruce px-7 py-[15px] text-[16.5px] font-semibold text-paper no-underline hover:bg-spruce-deep hover:text-paper"
              >
                List your place
              </Link>
            </div>
          </div>
          <div className="h-[420px] overflow-hidden rounded-card shadow-card lg:h-[560px]">
            <img src={HOST_IMG} alt="A host at their front door" className="h-full w-full object-cover" />
          </div>
        </section>

        <section id="owned" className="flex flex-col gap-[52px] bg-paper px-5 py-16 md:px-16 md:py-[108px]" aria-labelledby="owned-heading">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-deep">Member-owned</p>
            <h2 id="owned-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              The credit union of home rentals.
            </h2>
            <p className="m-0 max-w-[600px] text-[17.5px] leading-relaxed text-ink/62">
              No shareholders, no growth quota, no quiet fee creep. The people who stay and host own the network — and
              set its rules.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              [
                "Transparent rules",
                "The fee is 2%. The rulebook is public. Every change is announced before it happens — in writing, not in a settings update.",
              ],
              [
                "Members vote on changes",
                "One member, one vote — hosts and guests alike. Fee changes, rule changes, arbitration policy: all balloted.",
              ],
              [
                "No arbitrary delistings",
                "Nobody wakes up locked out. Removal requires a documented rule breach — and you see the evidence.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="flex flex-col gap-3.5 rounded-card bg-linen p-[34px]">
                <span className="text-xl font-bold">{title}</span>
                <p className="m-0 text-[15.5px] leading-relaxed text-ink/62">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <Wave />

        <section id="faq" className="flex flex-col items-center gap-11 bg-paper px-5 py-16 md:px-16 md:pb-[110px]" aria-labelledby="faq-heading">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="m-0 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass-deep">Fair questions</p>
            <h2 id="faq-heading" className="m-0 font-display text-[36px] font-semibold tracking-tight md:text-[46px]">
              Asked and answered.
            </h2>
          </div>
          <div className="flex w-full max-w-[860px] flex-col">
            {FAQ.map((item, i) => (
              <details key={item.q} className="border-b border-[#E5DDCA] py-[26px]" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[19px] font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="shrink-0 text-brass" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mb-0 mt-4 max-w-[760px] text-base leading-relaxed text-ink/65">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
    </Shell>
  );
}
