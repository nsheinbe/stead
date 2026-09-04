import { describe, expect, it } from "vitest";
import {
  MoneyError,
  MIN_STAY_NIGHTS,
  depositMethod,
  formatUsd,
  nightsBetween,
  quoteStay,
} from "../server/lib/pricing";

describe("quoteStay — integer cents only", () => {
  it.each([
    {
      name: "$200 × 30 nights → guest $6,120, host $6,000, $300 deposit apart",
      nightlyRateCents: 20_000,
      nights: 30,
      networkFeeBps: 200,
      depositCents: 30_000,
      stay: 600_000,
      fee: 12_000,
      total: 612_000,
    },
    {
      name: "30 nights at $146",
      nightlyRateCents: 14_600,
      nights: 30,
      networkFeeBps: 200,
      depositCents: 25_000,
      stay: 438_000,
      fee: 8_760,
      total: 446_760,
    },
    {
      name: "30 nights at $178 — fee truncates leftover hundredths",
      nightlyRateCents: 17_800,
      nights: 30,
      networkFeeBps: 200,
      depositCents: 28_000,
      stay: 534_000,
      fee: 10_680,
      total: 544_680,
    },
    {
      name: "zero fee bps",
      nightlyRateCents: 10_000,
      nights: 30,
      networkFeeBps: 0,
      depositCents: 0,
      stay: 300_000,
      fee: 0,
      total: 300_000,
    },
    {
      name: "odd subtotal truncates (10001 × 30 × 200 / 10000)",
      nightlyRateCents: 10_001,
      nights: 30,
      networkFeeBps: 200,
      depositCents: 1,
      stay: 300_030,
      fee: 6_000,
      total: 306_030,
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
      nights: 30,
      networkFeeBps: 200,
      depositCents: 30_000,
    });
    expect(quote.guest_total_cents).toBe(612_000);
    expect(quote.deposit_cents).toBe(30_000);
  });

  it("rejects floats", () => {
    expect(() =>
      quoteStay({ nightlyRateCents: 200.5, nights: 30, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(MoneyError);
  });

  it("rejects stays under the 30-night floor", () => {
    expect(() =>
      quoteStay({ nightlyRateCents: 20_000, nights: 0, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(MoneyError);
    expect(() =>
      quoteStay({ nightlyRateCents: 20_000, nights: 1, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(/at least 30 nights/);
    expect(() =>
      quoteStay({ nightlyRateCents: 20_000, nights: 3, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(/at least 30 nights/);
    expect(() =>
      quoteStay({ nightlyRateCents: 20_000, nights: 29, networkFeeBps: 200, depositCents: 0 }),
    ).toThrow(/at least 30 nights/);
  });
});

describe("nightsBetween", () => {
  it("counts a 30-night listing-local stay", () => {
    expect(nightsBetween("2026-08-08", "2026-09-07")).toBe(30);
    expect(MIN_STAY_NIGHTS).toBe(30);
  });

  it("rejects inverted, same-day, and short stays", () => {
    expect(() => nightsBetween("2026-08-13", "2026-08-08")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-08-08", "2026-08-08")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-08-08", "2026-08-09")).toThrow(/at least 30 nights/);
    expect(() => nightsBetween("2026-08-08", "2026-09-06")).toThrow(/at least 30 nights/);
  });

  it("rejects dates that do not exist on the calendar", () => {
    // V8 would roll these over (Feb 30 → Mar 2) and Postgres would then reject
    // the same string with 22008. Fail here, as a 400, instead.
    expect(() => nightsBetween("2026-02-28", "2026-02-30")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-02-29", "2026-03-02")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-13-01", "2026-13-03")).toThrow(MoneyError);
    expect(() => nightsBetween("2026-04-31", "2026-05-02")).toThrow(MoneyError);
    // Real leap day inside a 30-night stay is fine.
    expect(nightsBetween("2028-02-01", "2028-03-02")).toBe(30);
  });
});

describe("formatUsd", () => {
  it("formats whole dollars without cents", () => {
    expect(formatUsd(612_000)).toBe("$6,120");
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
    // Regulatory floor is 30 nights, so live bookings always take card-on-file.
    expect(depositMethod(30, 4)).toBe("card_on_file");
  });
});
