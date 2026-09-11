/**
 * HOST-03. Four facts, not one.
 *
 * "Set up payouts" hides an account that may not exist, a form that may not be
 * finished, charges Stripe may not have enabled, and payouts Stripe may be
 * holding. The last two move independently: an account can take a guest's money
 * while the payout is held, which looks fine right up until nothing arrives.
 *
 * The other rule asserted here is negative: coming back from Stripe is not
 * approval by Stripe.
 */
import { describe, expect, it } from "vitest";
import {
  payoutReadiness,
  READINESS_POLL_LIMIT,
  shouldPollReadiness,
} from "../src/lib/payoutReadiness";
import type { ConnectStatus } from "../src/lib/types";

function status(overrides: Partial<ConnectStatus> = {}): ConnectStatus {
  return {
    accountId: "acct_test",
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    ...overrides,
  };
}

describe("payout readiness", () => {
  it("tells a host with no account that a guest cannot pay", () => {
    const readiness = payoutReadiness(status({ accountId: null }));
    expect(readiness.stage).toBe("not_started");
    expect(readiness.canBePaid).toBe(false);
    expect(readiness.guestImpact).toMatch(/cannot pay/i);
    expect(readiness.action?.label).toBe("Set up payouts");
  });

  it("offers to resume rather than restart when the form is unfinished", () => {
    const readiness = payoutReadiness(status());
    expect(readiness.stage).toBe("incomplete");
    expect(readiness.canBePaid).toBe(false);
    // Reusing the account is the server's behaviour; the copy must match it.
    expect(readiness.action?.description).toMatch(/pick up where you left off/i);
  });

  it("separates 'Stripe has the details' from 'Stripe said yes'", () => {
    const readiness = payoutReadiness(status({ detailsSubmitted: true }));
    expect(readiness.stage).toBe("in_review");
    // The submission is not the approval, and a guest still cannot pay.
    expect(readiness.canBePaid).toBe(false);
    expect(readiness.guestImpact).toMatch(/cannot pay/i);
  });

  it("names the case where money comes in but does not go out", () => {
    const readiness = payoutReadiness(
      status({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: false }),
    );
    expect(readiness.stage).toBe("charges_only");
    // A stay can happen — so this is not "not ready" to a guest — but the host
    // is not being paid, and the copy says so rather than implying it is fine.
    expect(readiness.canBePaid).toBe(true);
    expect(readiness.guestImpact).toMatch(/holding the money/i);
    expect(readiness.action).not.toBeNull();
  });

  it("calls it live only when Stripe has enabled both", () => {
    const readiness = payoutReadiness(
      status({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }),
    );
    expect(readiness.stage).toBe("ready");
    expect(readiness.canBePaid).toBe(true);
    expect(readiness.action).toBeNull();
  });

  it("treats a missing status as not ready, never as ready", () => {
    expect(payoutReadiness(undefined).stage).toBe("not_started");
    expect(payoutReadiness(null).canBePaid).toBe(false);
  });

  it("never reads readiness out of charges alone", () => {
    // The one combination that would be easy to mistake for success.
    const readiness = payoutReadiness(status({ chargesEnabled: true }));
    expect(readiness.stage).not.toBe("ready");
  });
});

describe("waiting for Stripe after a return", () => {
  const pending = status({ detailsSubmitted: true });
  const live = status({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true });

  it("does not poll when the host did not just come back", () => {
    expect(shouldPollReadiness(pending, false, 0)).toBe(false);
  });

  it("polls a returning host until Stripe confirms", () => {
    expect(shouldPollReadiness(pending, true, 0)).toBe(true);
    expect(shouldPollReadiness(pending, true, READINESS_POLL_LIMIT - 1)).toBe(true);
  });

  it("stops the moment the account is live", () => {
    expect(shouldPollReadiness(live, true, 0)).toBe(false);
  });

  it("gives up after a bounded number of tries rather than spinning forever", () => {
    expect(shouldPollReadiness(pending, true, READINESS_POLL_LIMIT)).toBe(false);
    expect(shouldPollReadiness(pending, true, READINESS_POLL_LIMIT + 50)).toBe(false);
  });

  it("a return from Stripe is not itself an approval", () => {
    // `?done=1` with nothing enabled must never resolve to a live account.
    expect(payoutReadiness(status({ accountId: "acct_test" })).canBePaid).toBe(false);
    expect(shouldPollReadiness(status({ accountId: "acct_test" }), true, 0)).toBe(true);
  });
});
