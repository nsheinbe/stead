import { describe, expect, it } from "vitest";
import { destinationChargeParams, HostConnectError, resolveHostConnectAccount } from "../server/lib/stripe";

describe("resolveHostConnectAccount", () => {
  it("accepts a Stripe connected account id", () => {
    expect(resolveHostConnectAccount("acct_test123")).toBe("acct_test123");
    expect(resolveHostConnectAccount("  acct_1A2B3C  ")).toBe("acct_1A2B3C");
  });

  it("fails closed on missing or malformed ids — never a platform charge", () => {
    expect(() => resolveHostConnectAccount(null)).toThrow(HostConnectError);
    expect(() => resolveHostConnectAccount(undefined)).toThrow(HostConnectError);
    expect(() => resolveHostConnectAccount("")).toThrow(HostConnectError);
    expect(() => resolveHostConnectAccount("sk_test_secret")).toThrow(HostConnectError);
    expect(() => resolveHostConnectAccount("cus_123")).toThrow(HostConnectError);
  });
});

describe("destinationChargeParams", () => {
  it("routes guest_total to the host and keeps only the network fee", () => {
    const params = destinationChargeParams({
      guestTotalCents: 612_000,
      networkFeeCents: 12_000,
      destinationAccountId: "acct_host_test",
      metadata: { listing_id: "listing-1", guest_id: "guest-1" },
    });

    expect(params.amount).toBe(612_000);
    expect(params.application_fee_amount).toBe(12_000);
    expect(params.transfer_data).toEqual({ destination: "acct_host_test" });
    expect(params.on_behalf_of).toBe("acct_host_test");
    expect(params.currency).toBe("usd");
    expect(params.automatic_payment_methods).toEqual({ enabled: true });
    // Host is MOR: both destination and on_behalf_of must be the connected account.
    expect(params.on_behalf_of).toBe(params.transfer_data.destination);
    expect(params.application_fee_amount).toBeLessThan(params.amount);
  });

  it("refuses to build a platform-MOR payload", () => {
    expect(() =>
      destinationChargeParams({
        guestTotalCents: 612_000,
        networkFeeCents: 12_000,
        destinationAccountId: "",
        metadata: {},
      }),
    ).toThrow(HostConnectError);
  });

  it("refuses a fee larger than the charge", () => {
    expect(() =>
      destinationChargeParams({
        guestTotalCents: 100,
        networkFeeCents: 200,
        destinationAccountId: "acct_host_test",
        metadata: {},
      }),
    ).toThrow(HostConnectError);
  });
});
