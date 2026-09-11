import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  AccentSurface,
  Button,
  Card,
  DataList,
  DataRow,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { feePercent } from "../lib/fees";
import { formatUsd } from "../lib/money";
import { payoutReadiness, READINESS_POLL_LIMIT, READINESS_POLL_MS } from "../lib/payoutReadiness";
import type { HostPayout } from "../lib/types";

const PAYOUT_LABEL: Record<HostPayout["state"], string> = {
  scheduled: "Scheduled",
  paid: "Paid",
  frozen: "Frozen",
  failed: "Failed",
};

const PAYOUT_NOTE: Record<HostPayout["state"], string> = {
  scheduled: "Queued with Stripe.",
  paid: "Sent to your bank account.",
  frozen: "Held while a claim on this stay is open.",
  failed: "Stripe could not complete this payout.",
};

/**
 * Payouts and payout readiness.
 *
 * The page's job is to distinguish four facts that "set up payouts" otherwise
 * blurs together: whether an account exists, whether the host finished Stripe's
 * form, whether Stripe will accept a charge, and whether Stripe will pay out.
 * Only the last two decide whether a stay can happen, and they move
 * independently.
 *
 * A return from Stripe (`?done=1`) is treated as "the host came back", never as
 * "Stripe approved it". Readiness comes from the server, which retrieves the
 * account live; the return only starts a bounded poll while Stripe catches up.
 */
export function HostPayoutsPage() {
  const { user, status: sessionStatus } = useAuth();
  const [params] = useSearchParams();
  const returning = params.get("done") === "1";
  const linkExpired = params.get("refresh") === "1";

  // Bounded: a poll that never gives up leaves a host watching a spinner.
  const [attempts, setAttempts] = useState(0);
  const pollTimedOut = useRef(false);

  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const connect = useQuery({
    queryKey: ["connect-status", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.connectStatus(),
  });

  const readiness = payoutReadiness(connect.data);
  const polling = returning && !pollTimedOut.current && readiness.stage !== "ready";

  useEffect(() => {
    if (!polling) return;
    if (attempts >= READINESS_POLL_LIMIT) {
      pollTimedOut.current = true;
      setAttempts((n) => n + 1); // re-render once so the timeout message shows
      return;
    }
    const timer = window.setTimeout(() => {
      setAttempts((n) => n + 1);
      void connect.refetch();
    }, READINESS_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [polling, attempts, connect]);

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

  const feeLabel = config.data ? feePercent(config.data.networkFeeBps) : null;
  const rows = payouts.data ?? [];
  const scheduled = rows.filter((row) => row.state === "scheduled");
  const scheduledTotal = scheduled.reduce((sum, row) => sum + row.amountCents, 0);

  return (
    <Shell width="narrow" workspace="hosting" title="Payouts">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        {sessionStatus !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to set up payouts"
            description="Payout setup must be complete before a guest can pay for a stay."
            intent="homeowner"
          />
        ) : (
          <>
            <PageHeader
              title="Payouts"
              description="Guests pay you directly through Stripe. You are the merchant of record for every stay."
            />

            {linkExpired ? (
              <StatusMessage tone="info" title="That Stripe link had expired.">
                <p>Start again below to pick up where you left off. Nothing was charged.</p>
              </StatusMessage>
            ) : null}

            {/* --- readiness ------------------------------------------- */}
            <section aria-labelledby="readiness-heading" className="flex flex-col gap-4">
              <h2 id="readiness-heading" className="sr-only">
                Payout account status
              </h2>

              {connect.isPending ? (
                <Card aria-busy="true">
                  <p role="status" className="sr-only">
                    Checking your payout account
                  </p>
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="mt-3 h-4 w-3/4" />
                </Card>
              ) : connect.isError ? (
                <StatusMessage
                  tone="danger"
                  title="We couldn't check your payout account."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void connect.refetch()}>
                      Try again
                    </Button>
                  }
                >
                  <p>
                    This is about reaching Stripe, not about your account. Your existing stays and
                    payouts are unaffected.
                  </p>
                </StatusMessage>
              ) : (
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="m-0 text-card-title">{readiness.title}</h3>
                    <StatusPill tone={readiness.stage === "ready" ? "brand" : "neutral"}>
                      {readiness.canBePaid ? "Charges on" : "Not ready"}
                    </StatusPill>
                  </div>
                  <p className="mb-0 mt-2 text-ink-secondary">{readiness.guestImpact}</p>

                  <div className="mt-4">
                    <DataList>
                      <DataRow
                        label="Account with Stripe"
                        value={connect.data?.accountId ? "Created" : "Not created"}
                      />
                      <DataRow
                        label="Your details"
                        value={connect.data?.detailsSubmitted ? "Submitted" : "Not submitted"}
                      />
                      <DataRow
                        label="Can accept a guest's payment"
                        value={connect.data?.chargesEnabled ? "Yes" : "Not yet"}
                      />
                      <DataRow
                        label="Can pay out to your bank"
                        value={connect.data?.payoutsEnabled ? "Yes" : "Not yet"}
                      />
                    </DataList>
                  </div>

                  {readiness.action ? (
                    <div className="mt-5 flex flex-col gap-3">
                      <p className="m-0 text-sm text-ink-secondary">{readiness.action.description}</p>
                      <Button
                        className="self-start"
                        busy={onboard.isPending}
                        busyLabel="Opening Stripe…"
                        onClick={() => onboard.mutate()}
                      >
                        {readiness.action.label}
                      </Button>
                    </div>
                  ) : null}

                  {onboard.isError ? (
                    <div className="mt-4">
                      <StatusMessage tone="danger" title="We couldn't open Stripe.">
                        <p>
                          {onboard.error instanceof ApiError
                            ? onboard.error.message
                            : "Stripe didn't hand back a link. Please try again shortly."}
                        </p>
                      </StatusMessage>
                    </div>
                  ) : null}
                </Card>
              )}

              {returning && readiness.stage !== "ready" && !pollTimedOut.current ? (
                <StatusMessage tone="info" title="We're checking with Stripe.">
                  <p>
                    Coming back from Stripe doesn't finish the setup on its own — we wait for Stripe to
                    confirm. This page updates itself, and you can leave it.
                  </p>
                </StatusMessage>
              ) : null}

              {returning && pollTimedOut.current && readiness.stage !== "ready" ? (
                <StatusMessage
                  tone="info"
                  title="Stripe hasn't confirmed yet."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void connect.refetch()}>
                      Check again
                    </Button>
                  }
                >
                  <p>
                    Reviews can take longer than a few minutes. Nothing is lost — come back to this page
                    whenever, or check your Stripe account for anything outstanding.
                  </p>
                </StatusMessage>
              ) : null}
            </section>

            {/* --- what Stead takes ------------------------------------ */}
            <Surface padding="sm">
              <p className="m-0 text-sm text-ink-secondary">
                {feeLabel
                  ? `A guest pays the stay plus a ${feeLabel} network fee. That fee is all Stead takes; the stay itself goes to you.`
                  : "A guest pays the stay plus a network fee. That fee is all Stead takes; the stay itself goes to you."}
              </p>
            </Surface>

            {/* --- payouts --------------------------------------------- */}
            <section aria-labelledby="settled-heading" className="flex flex-col gap-4">
              <h2 id="settled-heading" className="m-0 text-card-title">
                Your payouts
              </h2>

              {scheduled.length > 0 ? (
                <AccentSurface>
                  <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">
                    Scheduled
                  </p>
                  <p className="money m-0 mt-1 text-[2rem] font-semibold">{formatUsd(scheduledTotal)}</p>
                  <p className="m-0 mt-1 text-sm text-ink-secondary">
                    Across {scheduled.length} {scheduled.length === 1 ? "stay" : "stays"}. Stripe decides
                    the payout date for your account.
                  </p>
                </AccentSurface>
              ) : null}

              {payouts.isPending ? (
                <div className="flex flex-col gap-3" aria-busy="true">
                  <p role="status" className="sr-only">
                    Loading your payouts
                  </p>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : payouts.isError ? (
                <StatusMessage
                  tone="danger"
                  title="We couldn't load your payouts."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void payouts.refetch()}>
                      Try again
                    </Button>
                  }
                />
              ) : rows.length === 0 ? (
                <EmptyState title="Nothing has settled yet.">
                  <p>A stay appears here once a guest has paid for it.</p>
                </EmptyState>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {rows.map((payout) => (
                    <li key={payout.id}>
                      <Card padding="sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="money m-0 font-semibold">{formatUsd(payout.amountCents)}</p>
                            <p className="m-0 text-sm text-ink-secondary">
                              {payout.paidAt
                                ? `Paid ${new Date(payout.paidAt).toLocaleDateString()}`
                                : PAYOUT_NOTE[payout.state]}
                            </p>
                          </div>
                          <StatusPill tone={payout.state === "paid" ? "brand" : "neutral"}>
                            {PAYOUT_LABEL[payout.state]}
                          </StatusPill>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
