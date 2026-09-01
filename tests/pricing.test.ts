import { describe, expect, it } from "vitest";
import {
  MoneyError,
  depositMethod,
  formatUsd,
  nightsBetween,
  quoteStay,
} from "../server/lib/pricing";

describe("quoteStay — integer cents only", () => {
  it.each([
    {
      name: "BUILD_PROMPT example: $200 × 5 nights → guest $1,020, host $1,000, $300 deposit apart",
      nightlyRateCents: 20_000,
      nights: 5,
      networkFeeBps: 200,
      depositCents: 30_000,
      stay: 100_000,
      fee: 2_000,
      total: 102_000,
    },
    {
      name: "one night at $146",
      nightlyRateCents: 14_600,
      nights: 1,
      networkFeeBps: 200,
      depositCents: 25_000,
      stay: 14_600,
      fee: 292,
      total: 14_892,
    },
    {
      name: "three nights at $178 — fee truncates leftover hundredths",
      nightlyRateCents: 17_800,
      nights: 3,
      networkFeeBps: 200,
      depositCents: 28_000,
      stay: 53_400,
      fee: 1_068,
      total: 54_468,
    },
    {
      name: "zero fee bps",
      nightlyRateCents: 10_000,
      nights: 2,
      networkFeeBps: 0,
      depositCents: 0,
      stay: 20_000,
      fee: 0,
      total: 20_000,
    },
    {
      name: "odd subtotal truncates (10001 × 200 / 10000)",
      nightlyRateCents: 10_001,
      nights: 1,
      networkFeeBps: 200,
      depositCents: 1,
      stay: 10_001,
      fee: 200,
      total: 10_201,
    },
  ])("$name", (row) => {
    const quote = quoteStay({
      nightlyRateCents: row.nightlyRateCents,
      nights: row.nights,
      networkFeeBps: row.networkFeeBps,
      depositCents: row.depositCents,
    });
    expect(quote.stay_subtotal_cents).toBe(row.stay);
    expect(quote.network_fee_cents).toBe(row.fee);
    expect(quote.guest_total_cents).toBe(row.total);
    expect(quote.deposit_cents).toBe(row.depositCents);
    expect(quote.guest_total_cents).toBe(quote.stay_subtotal_cents + quote.network_fee_cents);
    if (row.depositCents > 0) {
      expect(quote.guest_total_cents + quote.deposit_cents).not.toBe(quote.guest_total_cents);
    }
  });

  it("never adds the deposit into guest_total", () => {
    const quote = quoteStay({
      nightlyRateCents: 20_000,
      nights: 5,
      networkFeeBps: 200,
      depositCents: 30_000,
    });
    expect(quote.guest_total_cents).toBe(102_000);
    expect(quote.deposit_cents).toBe(30_000);
  });

  it("rejects floats", () => {
    expect(() =>
      quoteStay({ nightlyRateCents: 200.5, nights: 2, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(MoneyError);
  });

  it("rejects zero nights", () => {
    expect(() =>
      quoteStay({ nightlyRateCents: 20_000, nights: 0, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(MoneyError);
  });
});

describe("nightsBetween", () => {
  it("counts listing-local civil dates", () => {
    expect(nightsBetween("2026-08-08", "2026-08-13")).toBe(5);
    expect(nightsBetween("2026-08-08", "2026-08-09")).toBe(1);
  });

  it("rejects inverted or same-day stays", () => {
    expect(() => nightsBetween("2026-08-13", "2026-08-08")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-08-08", "2026-08-08")).toThrow(MoneyError);
  });

  it("rejects dates that do not exist on the calendar", () => {
    // V8 would roll these over (Feb 30 → Mar 2) and Postgres would then reject
    // the same string with 22008. Fail here, as a 400, instead.
    expect(() => nightsBetween("2026-02-28", "2026-02-30")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-02-29", "2026-03-02")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-13-01", "2026-13-03")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-04-31", "2026-05-02")).toThrow(MoneyError);
    // Real leap day is fine.
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("formatUsd", () => {
  it("formats whole dollars without cents", () => {
    expect(formatUsd(102_000)).toBe("$1,020");
    expect(formatUsd(20_000)).toBe("$200");
  });

  it("keeps leftover cents", () => {
    expect(formatUsd(14_892)).toBe("$148.92");
  });
});

describe("depositMethod", () => {
  it("auth-holds short stays and uses card-on-file past the cap", () => {
    expect(depositMethod(4, 4)).toBe("auth_hold");
    expect(depositMethod(5, 4)).toBe("card_on_file");
  });
});
