/**
 * Slice 6 — full refund matrix per policy × timing.
 *
 * Figures are integer cents. The worked example is the regulatory floor:
 * $200 × 30 nights → $6,000 stay, $120 fee, $6,120 guest total, $300 deposit.
 * Deposit is asserted released on every row and never added into the refund.
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  DEPOSIT_ON_CANCEL,
  FLEXIBLE_FULL_MS,
  HOUR_MS,
  MODERATE_FULL_MS,
  POLICY_RULES,
  STRICT_FULL_MS,
  STRICT_HALF_MS,
  listingLocalCheckInAt,
  msUntilListingLocalCheckIn,
  quoteCancellation,
  quoteGuestCancel,
  quoteHostCancel,
  quotePendingCancel,
} from "../server/lib/cancellation";

const STAY = 600_000;
const FEE = 12_000;
const NIGHT = 20_000;
const DEPOSIT = 30_000;
const TOTAL = STAY + FEE;

const BASE = {
  staySubtotalCents: STAY,
  networkFeeCents: FEE,
  nightlyRateCents: NIGHT,
  depositCents: DEPOSIT,
} as const;

function guest(policy: "flexible" | "moderate" | "strict", msUntilCheckIn: number) {
  return quoteGuestCancel({ policy, ...BASE, msUntilCheckIn });
}

describe("quoteGuestCancel — policy × timing matrix", () => {
  it.each([
    {
      name: "flexible · exactly 24h → 100% stay + fee",
      policy: "flexible" as const,
      ms: FLEXIBLE_FULL_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "flexible · 48h → 100% stay + fee",
      policy: "flexible" as const,
      ms: 48 * HOUR_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "flexible · just inside 24h → first night kept, fee kept",
      policy: "flexible" as const,
      ms: FLEXIBLE_FULL_MS - 1,
      refund: STAY - NIGHT,
      stay: STAY - NIGHT,
      fee: 0,
      feeKept: FEE,
      firstNight: NIGHT,
      band: "partial_first_night",
      after: false,
    },
    {
      name: "flexible · 1h before check-in → first night kept",
      policy: "flexible" as const,
      ms: HOUR_MS,
      refund: STAY - NIGHT,
      stay: STAY - NIGHT,
      fee: 0,
      feeKept: FEE,
      firstNight: NIGHT,
      band: "partial_first_night",
      after: false,
    },
    {
      name: "flexible · after check-in is still the <24h band",
      policy: "flexible" as const,
      ms: -HOUR_MS,
      refund: STAY - NIGHT,
      stay: STAY - NIGHT,
      fee: 0,
      feeKept: FEE,
      firstNight: NIGHT,
      band: "partial_first_night",
      after: true,
    },
    {
      name: "moderate · exactly 5 days → 100% + fee",
      policy: "moderate" as const,
      ms: MODERATE_FULL_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "moderate · 6 days → 100% + fee",
      policy: "moderate" as const,
      ms: 6 * DAY_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "moderate · just inside 5 days → 50% of stay, fee kept",
      policy: "moderate" as const,
      ms: MODERATE_FULL_MS - 1,
      refund: 300_000,
      stay: 300_000,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "half",
      after: false,
    },
    {
      name: "moderate · 1 day before check-in → 50% of stay",
      policy: "moderate" as const,
      ms: DAY_MS,
      refund: 300_000,
      stay: 300_000,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "half",
      after: false,
    },
    {
      name: "moderate · after check-in → no refund",
      policy: "moderate" as const,
      ms: -1,
      refund: 0,
      stay: 0,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "none",
      after: true,
    },
    {
      name: "strict · exactly 14 days → 100% + fee",
      policy: "strict" as const,
      ms: STRICT_FULL_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "strict · 15 days → 100% + fee",
      policy: "strict" as const,
      ms: 15 * DAY_MS,
      refund: TOTAL,
      stay: STAY,
      fee: FEE,
      feeKept: 0,
      firstNight: 0,
      band: "full",
      after: false,
    },
    {
      name: "strict · just inside 14 days → 50% of stay (14–7 band)",
      policy: "strict" as const,
      ms: STRICT_FULL_MS - 1,
      refund: 300_000,
      stay: 300_000,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "half",
      after: false,
    },
    {
      name: "strict · exactly 7 days → 50% of stay",
      policy: "strict" as const,
      ms: STRICT_HALF_MS,
      refund: 300_000,
      stay: 300_000,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "half",
      after: false,
    },
    {
      name: "strict · just inside 7 days → no refund",
      policy: "strict" as const,
      ms: STRICT_HALF_MS - 1,
      refund: 0,
      stay: 0,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "none",
      after: false,
    },
    {
      name: "strict · after check-in → no refund",
      policy: "strict" as const,
      ms: -DAY_MS,
      refund: 0,
      stay: 0,
      fee: 0,
      feeKept: FEE,
      firstNight: 0,
      band: "none",
      after: true,
    },
  ])("$name", (row) => {
    const quote = guest(row.policy, row.ms);
    expect(quote.refundCents).toBe(row.refund);
    expect(quote.stayRefundCents).toBe(row.stay);
    expect(quote.feeRefundCents).toBe(row.fee);
    expect(quote.feeRetainedCents).toBe(row.feeKept);
    expect(quote.firstNightRetainedCents).toBe(row.firstNight);
    expect(quote.depositReleasedCents).toBe(DEPOSIT);
    expect(quote.band).toBe(row.band);
    expect(quote.afterCheckIn).toBe(row.after);
    expect(
      quote.stayRefundCents +
        (STAY - quote.stayRefundCents) +
        quote.feeRefundCents +
        quote.feeRetainedCents,
    ).toBe(TOTAL);
    expect(quote.refundCents).toBe(quote.stayRefundCents + quote.feeRefundCents);
    expect(quote.refundCents + DEPOSIT).not.toBe(quote.refundCents === 0 ? DEPOSIT + 1 : quote.refundCents);
  });

  it("never folds the deposit into the stay refund", () => {
    const quote = guest("flexible", 10 * DAY_MS);
    expect(quote.refundCents).toBe(TOTAL);
    expect(quote.depositReleasedCents).toBe(DEPOSIT);
    expect(quote.refundCents).not.toBe(TOTAL + DEPOSIT);
  });

  it("truncates a 50% stay with an odd cent", () => {
    const quote = quoteGuestCancel({
      policy: "moderate",
      staySubtotalCents: 100_001,
      networkFeeCents: 2_000,
      nightlyRateCents: 3_334,
      depositCents: 1,
      msUntilCheckIn: DAY_MS,
    });
    expect(quote.stayRefundCents).toBe(50_000);
    expect(quote.refundCents).toBe(50_000);
    expect(quote.feeRefundCents).toBe(0);
  });
});

describe("quoteHostCancel / pending / dispatcher", () => {
  it("host cancel is always 100% stay + fee, deposit released", () => {
    const quote = quoteHostCancel({
      staySubtotalCents: STAY,
      networkFeeCents: FEE,
      depositCents: DEPOSIT,
    });
    expect(quote.refundCents).toBe(TOTAL);
    expect(quote.feeRefundCents).toBe(FEE);
    expect(quote.band).toBe("host");
    expect(quote.depositReleasedCents).toBe(DEPOSIT);
    expect(quote.refundApplicationFee).toBe(true);
  });

  it("pending_payment quotes a zero refund for guest or host", () => {
    const pending = quotePendingCancel(DEPOSIT);
    expect(pending.refundCents).toBe(0);
    expect(pending.band).toBe("pending");
    expect(pending.depositReleasedCents).toBe(DEPOSIT);

    expect(
      quoteCancellation({
        actor: "guest",
        status: "pending_payment",
        policy: "strict",
        ...BASE,
        msUntilCheckIn: HOUR_MS,
      }).band,
    ).toBe("pending");
    expect(
      quoteCancellation({
        actor: "host",
        status: "pending_payment",
        policy: "flexible",
        ...BASE,
        msUntilCheckIn: 20 * DAY_MS,
      }).refundCents,
    ).toBe(0);
  });

  it("dispatcher uses host rules on a confirmed stay regardless of policy timing", () => {
    const quote = quoteCancellation({
      actor: "host",
      status: "confirmed",
      policy: "strict",
      ...BASE,
      msUntilCheckIn: HOUR_MS,
    });
    expect(quote.refundCents).toBe(TOTAL);
    expect(quote.band).toBe("host");
  });

  it("pre-check-in full refunds reverse the transfer; post-check-in do not", () => {
    const pre = quoteGuestCancel({ policy: "flexible", ...BASE, msUntilCheckIn: 2 * DAY_MS });
    const post = quoteGuestCancel({
      policy: "flexible",
      ...BASE,
      msUntilCheckIn: -HOUR_MS,
      alreadyCheckedIn: true,
    });
    expect(pre.reverseTransfer).toBe(true);
    expect(post.reverseTransfer).toBe(false);
  });
});

describe("listing-local check-in instant", () => {
  it("treats 16:00 America/New_York as 20:00 UTC in August (EDT)", () => {
    const at = listingLocalCheckInAt("2026-08-08", "America/New_York", "16:00");
    expect(at.toISOString()).toBe("2026-08-08T20:00:00.000Z");
  });

  it("treats 16:00 America/Los_Angeles as 00:00 UTC the next civil day in January (PST)", () => {
    const at = listingLocalCheckInAt("2026-01-15", "America/Los_Angeles", "16:00");
    expect(at.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("msUntil is 24h at the flexible boundary for a Kyoto listing", () => {
    const checkInAt = listingLocalCheckInAt("2026-09-01", "Asia/Tokyo", "16:00");
    const now = new Date(checkInAt.getTime() - FLEXIBLE_FULL_MS);
    expect(
      msUntilListingLocalCheckIn({
        now,
        checkIn: "2026-09-01",
        timezone: "Asia/Tokyo",
        checkinLocalTime: "16:00",
      }),
    ).toBe(FLEXIBLE_FULL_MS);
  });
});

describe("policy copy", () => {
  it("names each band without banned words", () => {
    const banned = /\b(blockchain|crypto|wallet|token|web3|DAO|smart contract|on-chain|gas)\b/i;
    for (const lines of Object.values(POLICY_RULES)) {
      expect(lines.join(" ")).not.toMatch(banned);
    }
    expect(DEPOSIT_ON_CANCEL).not.toMatch(banned);
    expect(DEPOSIT_ON_CANCEL).toMatch(/deposit/i);
  });
});
