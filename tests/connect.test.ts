import { describe, expect, it } from "vitest";
import {
  createIntent,
  destinationChargeParams,
  HostConnectError,
  intentIdempotencyKey,
  resolveHostConnectAccount,
} from "../server/lib/stripe";

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

describe("intentIdempotencyKey", () => {
  it("is stable for one booking attempt and distinct across attempts", () => {
    const key = intentIdempotencyKey("pi", "g1", "l1", "2026-10-01", "2026-10-31");

    expect(intentIdempotencyKey("pi", "g1", "l1", "2026-10-01", "2026-10-31")).toBe(key);
    // A different intent kind, member, listing, or either date is a different
    // attempt and must not replay the first one's intent.
    expect(intentIdempotencyKey("seti", "g1", "l1", "2026-10-01", "2026-10-31")).not.toBe(key);
    expect(intentIdempotencyKey("pi", "g2", "l1", "2026-10-01", "2026-10-31")).not.toBe(key);
    expect(intentIdempotencyKey("pi", "g1", "l2", "2026-10-01", "2026-10-31")).not.toBe(key);
    expect(intentIdempotencyKey("pi", "g1", "l1", "2026-10-02", "2026-10-31")).not.toBe(key);
    expect(intentIdempotencyKey("pi", "g1", "l1", "2026-10-01", "2026-11-30")).not.toBe(key);
  });

  it("does not carry the member id into a value Stripe stores", () => {
    const key = intentIdempotencyKey("pi", "guest-uuid-secret", "l1", "2026-10-01", "2026-10-31");
    expect(key).not.toContain("guest-uuid-secret");
  });
});

describe("createIntent", () => {
  it("uses the idempotency key and returns a usable intent unchanged", async () => {
    const keys: string[] = [];
    const intent = await createIntent(async (options) => {
      keys.push(options.idempotencyKey);
      return { id: "pi_live", status: "requires_payment_method" };
    }, "booking:pi:abc");

    expect(intent.id).toBe("pi_live");
    expect(keys).toEqual(["booking:pi:abc"]);
  });

  it("retries under a fresh key when Stripe replays a cancelled intent", async () => {
    // An earlier attempt on these dates rolled back and cancelled its intent.
    // Replaying it would hand the member a dead client secret.
    const keys: string[] = [];
    const intent = await createIntent(async (options) => {
      keys.push(options.idempotencyKey);
      return keys.length === 1
        ? { id: "pi_cancelled", status: "canceled" }
        : { id: "pi_fresh", status: "requires_payment_method" };
    }, "booking:pi:abc");

    expect(intent.id).toBe("pi_fresh");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe("booking:pi:abc");
    expect(keys[1]).toMatch(/^booking:pi:abc:/);
  });
});
