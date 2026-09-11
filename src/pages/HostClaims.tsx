import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { prettyRange } from "../lib/dates";
import { formatUsd } from "../lib/money";
import { CLAIM_STATE_LABEL, type ClaimState } from "../lib/types";

/**
 * What each state means, and whether anyone is waiting on anyone.
 *
 * A state name alone doesn't say whose move it is, which is the only thing a
 * list like this needs to convey.
 */
const STATE_NOTE: Record<ClaimState, string> = {
  open: "Waiting on the guest to accept or dispute.",
  guest_accepted: "The guest accepted. The agreed amount was charged.",
  guest_disputed: "The guest disputed. An arbiter decides.",
  arbitration: "With an arbiter.",
  resolved_host: "Resolved in the host's favour.",
  resolved_guest: "Resolved in the guest's favour. The deposit was released.",
  resolved_split: "Resolved by splitting the amount claimed.",
};

/** Whether this claim is waiting on somebody, or finished. */
function isLive(state: ClaimState): boolean {
  return state === "open" || state === "guest_disputed" || state === "arbitration";
}

export function HostClaimsPage() {
  const { user, status } = useAuth();
  const claims = useQuery({
    queryKey: ["claims", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.claims(),
  });

  const rows = claims.data ?? [];
  const live = rows.filter((claim) => isLive(claim.state));
  const settled = rows.filter((claim) => !isLive(claim.state));

  function section(title: string, list: typeof rows) {
    if (list.length === 0) return null;
    return (
      <section aria-labelledby={`claims-${title}`} className="flex flex-col gap-4">
        <h2 id={`claims-${title}`} className="m-0 text-card-title">
          {title}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {list.map((claim) => (
            <li key={claim.id}>
              <Card padding="sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 font-semibold">
                      <Link to={`/host/claims/${claim.id}`}>{claim.listingTitle}</Link>
                    </p>
                    <p className="m-0 text-sm text-ink-secondary">
                      {prettyRange(claim.checkIn, claim.checkOut)}
                    </p>
                    <p className="money m-0 text-sm text-ink-secondary">
                      {formatUsd(claim.amountCents)} claimed
                    </p>
                  </div>
                  <StatusPill
                    tone={claim.state === "open" || claim.state === "guest_disputed" ? "danger" : "neutral"}
                  >
                    {CLAIM_STATE_LABEL[claim.state]}
                  </StatusPill>
                </div>
                <p className="m-0 mt-3 text-sm text-ink-secondary">{STATE_NOTE[claim.state]}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <Shell width="narrow" workspace="hosting" title="Claims">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to see your claims"
            description="A claim is visible to the two people on the stay it belongs to, and to an arbiter."
          />
        ) : (
          <>
            <PageHeader
              title="Claims"
              description="Damage claims on stays you were part of, and where each one stands."
            />

            {claims.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <p role="status" className="sr-only">
                  Loading claims
                </p>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : claims.isError ? (
              <StatusMessage
                tone="danger"
                title="We couldn't load your claims."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void claims.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState title="No claims.">
                <p>
                  A claim appears here if a host files one during the claim window after a stay. Most
                  stays never have one.
                </p>
              </EmptyState>
            ) : (
              <>
                {section("Waiting on someone", live)}
                {section("Settled", settled)}
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
