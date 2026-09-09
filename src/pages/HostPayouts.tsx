import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { formatUsd } from "../lib/money";
import type { HostPayout } from "../lib/types";

const PAYOUT_LABEL: Record<HostPayout["state"], string> = {
  scheduled: "Scheduled",
  paid: "Paid",
  frozen: "Frozen",
  failed: "Failed",
};

export function HostPayoutsPage() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const returning = params.get("done") === "1";
  const refresh = params.get("refresh") === "1";

  const status = useQuery({
    queryKey: ["connect-status", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.connectStatus(),
    refetchInterval: (query) => {
      if (!returning) return false;
      const data = query.state.data;
      if (data?.chargesEnabled && data?.payoutsEnabled) return false;
      return 3_000;
    },
  });

  const payouts = useQuery({
    queryKey: ["host-payouts", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.hostPayouts(),
  });

  const onboard = useMutation({
    mutationFn: () => api.connectOnboard(),
    onSuccess: (result) => {
      // Stripe hosts the form; we hand the host over and they come back.
      window.location.href = result.url;
    },
  });

  const ready = status.data?.chargesEnabled && status.data?.payoutsEnabled;
  const nextPayout = payouts.data?.find((row) => row.state === "scheduled") ?? payouts.data?.[0];

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-3.5 px-[18px] pb-4 pt-16 md:pt-4">
        <HostSubnav />
        <h1 className="m-0 font-display text-2xl font-semibold">Payouts</h1>

        {loading ? (
          <StatusBanner title="Checking your session…" />
        ) : !user ? (
          <StatusBanner title="Sign in to set up payouts" />
        ) : (
          <>
            {refresh && !ready && (
              <StatusBanner
                title="That Stripe link expired"
                detail="Continue to Stripe to pick up where you left off. Nothing was charged."
              />
            )}
            {returning && status.data && !ready && (
              <StatusBanner
                title={
                  status.data.detailsSubmitted
                    ? "Stripe has your details"
                    : "Finishing payout setup"
                }
                detail="Payouts go live once charges and payouts are enabled — usually a few minutes. You can leave this page."
              />
            )}

            {status.isLoading && <StatusBanner title="Checking your payout account…" />}
            {status.isError && (
              <StatusBanner
                tone="claim"
                title="Could not reach Stripe"
                detail="Your payout status is unavailable right now. Try again shortly."
              />
            )}

            {status.data && !ready && (
              <div className="flex flex-col gap-3 rounded-card border-[1.5px] border-dashed border-brass/75 bg-brass/[0.06] p-[18px]">
                <span className="text-sm font-bold">
                  {status.data.accountId ? "Finish setting up payouts" : "Set up payouts"}
                </span>
                <p className="m-0 text-[12.5px] leading-relaxed text-ink/65">
                  Guests pay you directly — you are the merchant of record, and Stead keeps only
                  the 2% network fee. Stripe collects the details it needs to pay you.
                  {status.data.accountId && " You can pick up where you left off."}
                </p>
                <button
                  type="button"
                  onClick={() => onboard.mutate()}
                  disabled={onboard.isPending}
                  className="self-start rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                >
                  {onboard.isPending ? "Opening Stripe…" : "Continue to Stripe"}
                </button>
                {onboard.isError && (
                  <StatusBanner
                    tone="claim"
                    title="Could not start onboarding"
                    detail="Stripe did not hand back a link. If this keeps happening, Connect is not enabled on the platform yet."
                  />
                )}
              </div>
            )}

            {ready && (
              <div className="flex flex-col gap-1.5 rounded-card bg-spruce px-[18px] py-4 text-paper">
                <span className="text-[11px] font-bold tracking-[0.16em] text-paper/60">
                  {nextPayout ? "NEXT PAYOUT" : "PAYOUTS LIVE"}
                </span>
                <span className="money font-display text-[40px] font-bold leading-none">
                  {nextPayout ? formatUsd(nextPayout.amountCents) : "Ready"}
                </span>
                <p className="m-0 mt-1 text-xs text-paper/75">
                  {nextPayout
                    ? "Stays settle to your account when the guest pays. Stead keeps only the 2% network fee."
                    : "Your payout account is live. Stays settle here when the guest pays."}
                </p>
              </div>
            )}

            <h2 className="m-0 mt-2 font-display text-lg font-semibold">Settled stays</h2>
            {payouts.isLoading && <StatusBanner title="Loading payouts…" />}
            {payouts.isError && (
              <StatusBanner tone="claim" title="Could not load your payouts" />
            )}
            {payouts.data?.length === 0 && (
              <StatusBanner
                title="Nothing settled yet"
                detail="A stay appears here once the guest has paid."
              />
            )}
            {payouts.data?.map((payout) => (
              <div
                key={payout.id}
                className="flex items-center justify-between rounded-card border border-linen-tint px-4 py-3.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="money text-sm font-bold">{formatUsd(payout.amountCents)}</span>
                  <span className="text-xs text-ink/55">
                    {payout.paidAt
                      ? new Date(payout.paidAt).toLocaleDateString()
                      : "Awaiting settlement"}
                  </span>
                </div>
                <span className="text-[11.5px] font-bold tracking-[0.1em] text-ink/50">
                  {PAYOUT_LABEL[payout.state].toUpperCase()}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </Shell>
  );
}
