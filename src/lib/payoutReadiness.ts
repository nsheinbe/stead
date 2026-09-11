/**
 * What Stripe has actually said about a host's account.
 *
 * Four different facts hide behind "set up payouts", and conflating them is
 * how a host ends up believing they can be paid when they cannot:
 *
 *   - whether an account exists at all;
 *   - whether the host finished Stripe's form (`details_submitted`);
 *   - whether Stripe will let that account take a charge (`charges_enabled`);
 *   - whether Stripe will pay the balance out (`payouts_enabled`).
 *
 * Only the last two decide whether a stay can go through, and they move
 * independently — an account can be charge-enabled with payouts still held,
 * which looks fine right up until the money does not arrive.
 *
 * Nothing here infers a state from a return URL. `?done=1` means the host came
 * back from Stripe, not that Stripe approved anything; the only source of
 * truth is the readiness the server retrieved.
 */
import type { ConnectStatus } from "./types";

export type PayoutStage = "not_started" | "incomplete" | "in_review" | "charges_only" | "ready";

export type PayoutReadiness = {
  stage: PayoutStage;
  /** What to call this state, in the host's terms. */
  title: string;
  /** What it means for a guest trying to book right now. */
  guestImpact: string;
  /** Whether a stay can be paid for today. Only `ready` is true. */
  canBePaid: boolean;
  /** Whether to offer the Stripe hand-off, and what to call it. */
  action: { label: string; description: string } | null;
};

export function payoutReadiness(status: ConnectStatus | undefined | null): PayoutReadiness {
  if (!status || !status.accountId) {
    return {
      stage: "not_started",
      title: "Payouts aren't set up yet",
      guestImpact: "A guest can see your homes but cannot pay for a stay.",
      canBePaid: false,
      action: {
        label: "Set up payouts",
        description:
          "Guests pay you directly — you are the merchant of record. Stripe collects the details it needs to pay you.",
      },
    };
  }

  if (!status.detailsSubmitted) {
    return {
      stage: "incomplete",
      title: "Stripe still needs some details",
      guestImpact: "A guest cannot pay for a stay until this is finished.",
      canBePaid: false,
      action: {
        label: "Continue with Stripe",
        description: "You can pick up where you left off — your progress is saved with Stripe.",
      },
    };
  }

  if (!status.chargesEnabled) {
    return {
      stage: "in_review",
      title: "Stripe has your details and is reviewing them",
      guestImpact: "A guest cannot pay for a stay until Stripe enables charges on your account.",
      canBePaid: false,
      // Stripe often asks for one more thing during review, and the link is
      // where that request appears. Offering it is not the same as saying
      // something is missing.
      action: {
        label: "Check your Stripe account",
        description:
          "Reviews usually finish in a few minutes. If Stripe needs anything more, it will ask you here.",
      },
    };
  }

  if (!status.payoutsEnabled) {
    return {
      stage: "charges_only",
      title: "Charges are enabled, payouts are not",
      guestImpact:
        "A guest can pay for a stay, but Stripe is holding the money rather than paying it out to you.",
      canBePaid: true,
      action: {
        label: "Resolve this with Stripe",
        description:
          "Stripe usually holds payouts pending a bank account or a verification. It will tell you which.",
      },
    };
  }

  return {
    stage: "ready",
    title: "Your payout account is live",
    guestImpact: "Guests can pay for stays, and Stripe pays you out.",
    canBePaid: true,
    action: null,
  };
}

/**
 * Whether to keep asking the server for readiness.
 *
 * Stripe's own state changes behind us, so a host returning from onboarding is
 * polled for a bounded while rather than shown a state that never updates. It
 * stops at `ready`, and it stops after the window either way — a spinner that
 * runs forever is a worse answer than a stale one with a refresh button.
 */
export const READINESS_POLL_MS = 3_000;
export const READINESS_POLL_LIMIT = 20;

export function shouldPollReadiness(
  status: ConnectStatus | undefined,
  justReturned: boolean,
  attempts: number,
): boolean {
  if (!justReturned) return false;
  if (attempts >= READINESS_POLL_LIMIT) return false;
  return payoutReadiness(status).stage !== "ready";
}
