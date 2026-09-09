import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_TAKE_BPS,
  FEE_SLIDER_MIN_NIGHTS,
  clampFeeSliderNights,
  compareStayFees,
} from "../server/lib/feeCompare";
import { MoneyError, quoteStay } from "../server/lib/pricing";

describe("compareStayFees — integer cents, Stead side is quoteStay", () => {
  it("$200 × 30 nights vs a 15% typical take", () => {
    const row = compareStayFees({
      nightlyRateCents: 20_000,
      nights: 30,
      networkFeeBps: 200,
      platformTakeBps: DEFAULT_PLATFORM_TAKE_BPS,
    });
    const quote = quoteStay({
      nightlyRateCents: 20_000,
      nights: 30,
      networkFeeBps: 200,
      depositCents: 0,
    });

    expect(row.staySubtotalCents).toBe(600_000);
    expect(row.networkFeeCents).toBe(quote.network_fee_cents);
    expect(row.steadGuestCents).toBe(quote.guest_total_cents);
    expect(row.steadHostCents).toBe(600_000);
    // 15% take, 4/5 on the guest (12%) and 1/5 on the host (3%).
    expect(row.otherGuestCents).toBe(672_000);
    expect(row.otherHostCents).toBe(582_000);
    expect(row.otherTakeCents).toBe(90_000);
    expect(row.staysBetweenCents).toBe(78_000);
    expect(row.guestSavesCents).toBe(60_000);
    expect(row.hostGainsCents).toBe(18_000);
    expect(row.steadGuestCents + row.steadHostCents).not.toBe(row.otherGuestCents + row.otherHostCents);
  });

  it("never uses floats and never drops below the 30-night floor", () => {
    const row = compareStayFees({
      nightlyRateCents: 14_600,
      nights: 5,
      networkFeeBps: 200,
    });
    expect(row.nights).toBe(FEE_SLIDER_MIN_NIGHTS);
    expect(Number.isInteger(row.steadGuestCents)).toBe(true);
    expect(Number.isInteger(row.otherTakeCents)).toBe(true);
    expect(clampFeeSliderNights(1)).toBe(30);
  });

  it("rejects a non-integer nightly rate", () => {
    expect(() =>
      compareStayFees({ nightlyRateCents: 200.5, nights: 30, networkFeeBps: 200 }),
    ).toThrow(MoneyError);
  });
});
