import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { prettyRange } from "../lib/dates";
import { formatUsd } from "../lib/money";
import { CLAIM_STATE_LABEL, type ClaimState } from "../lib/types";

function toneFor(state: ClaimState): "linen" | "claim" {
  return state === "guest_disputed" || state === "arbitration" ? "claim" : "linen";
}

export function HostClaimsPage() {
  const { user, status } = useAuth();
  const claims = useQuery({
    queryKey: ["claims", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.claims(),
  });

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <HostSubnav />
        <h1 className="m-0 font-display text-2xl font-semibold">Claims</h1>

        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to see your claims"
            description="Claims are visible to the parties on the stay they belong to."
          />
        ) : null}
        {claims.isLoading && user ? <StatusBanner title="Loading claims…" /> : null}
        {claims.isError ? (
          <StatusBanner tone="claim" title="Could not load claims" />
        ) : null}
        {claims.data?.length === 0 ? (
          <StatusBanner
            title="No claims"
            detail="A claim appears here when a host files one during the claim window."
          />
        ) : null}

        {claims.data?.map((claim) => (
          <Link
            key={claim.id}
            to={`/host/claims/${claim.id}`}
            className="flex items-center justify-between rounded-card border border-linen-tint px-4 py-3.5 no-underline"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-ink">{claim.listingTitle}</span>
              <span className="text-xs text-ink/55">
                {prettyRange(claim.checkIn, claim.checkOut)} · {formatUsd(claim.amountCents)}
              </span>
            </div>
            <span
              className={`text-[11.5px] font-bold tracking-[0.1em] ${
                toneFor(claim.state) === "claim" ? "text-claim" : "text-ink/50"
              }`}
            >
              {CLAIM_STATE_LABEL[claim.state].toUpperCase()}
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
