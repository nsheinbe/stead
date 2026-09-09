import { describe, expect, it } from "vitest";
import { dollarsToCents } from "../src/lib/cents";

describe("dollarsToCents", () => {
  it("parses whole dollars and two-place amounts as integer cents", () => {
    expect(dollarsToCents("150")).toBe(15000);
    expect(dollarsToCents("150.00")).toBe(15000);
    expect(dollarsToCents("1.5")).toBe(150);
    expect(dollarsToCents("0.07")).toBe(7);
  });

  it("rejects floats, signs, and extra decimals", () => {
    expect(dollarsToCents("1.234")).toBeNull();
    expect(dollarsToCents("-12")).toBeNull();
    expect(dollarsToCents("12.3.4")).toBeNull();
    expect(dollarsToCents("")).toBeNull();
  });
});
