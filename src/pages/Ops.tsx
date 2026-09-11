import { useQuery } from "@tanstack/react-query";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  DataRow,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { formatUsd } from "../lib/money";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

/**
 * Operations.
 *
 * Read-only by design: nothing here changes state, because every state change
 * in this system goes through an enumerated `SECURITY DEFINER` function with
 * its own gate. An ops screen that could move money would be a second path
 * around those gates.
 *
 * The 403 is a first-class state, not an error. An account without the ops
 * flag is not broken — it simply isn't an ops account, and saying so beats a
 * red failure box.
 */
export function OpsPage() {
  const { user, status } = useAuth();

  const ops = useQuery({
    queryKey: ["ops"],
    enabled: Boolean(user),
    queryFn: () => api.ops(),
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 1,
  });

  const forbidden = ops.error instanceof ApiError && ops.error.status === 403;

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" title="Operations">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to open operations"
            description="This view is limited to accounts flagged for operations."
          />
        </div>
      </Shell>
    );
  }

  if (forbidden) {
    return (
      <Shell width="narrow" title="Operations">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="This page is for operations accounts."
            description="Your account isn't flagged for it. Nothing is wrong with your account."
          />
          <ButtonLink to="/" className="self-start">
            Back to Stead
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const data = ops.data;

  return (
    <Shell title="Operations">
      <div className="flex flex-1 flex-col gap-8 py-6 sm:py-8">
        <PageHeader
          title="Operations"
          description="Card disputes, scheduled-job health and frozen payouts. Read-only: every state change goes through its own gated function, not through this page."
        />

        {ops.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p role="status" className="sr-only">
              Loading operations
            </p>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : ops.isError ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load operations."
            action={
              <Button variant="secondary" size="sm" onClick={() => void ops.refetch()}>
                Try again
              </Button>
            }
          />
        ) : data ? (
          <>
            {/* --- disputes ----------------------------------------- */}
            <section aria-labelledby="disputes-heading" className="flex flex-col gap-4">
              <h2 id="disputes-heading" className="m-0 text-card-title">
                Card disputes
              </h2>
              <p className="m-0 max-w-reading text-sm text-ink-secondary">
                An open dispute freezes the booking's payout and blocks every claim transition on it
                until the bank closes its case.
              </p>
              {data.disputes.length === 0 ? (
                <EmptyState title="No chargebacks on record." />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {data.disputes.map((row) => (
                    <li key={row.id}>
                      <Card padding="sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="money m-0 font-semibold">{formatUsd(row.amountCents)}</p>
                          <StatusPill tone={row.closedAt ? "neutral" : "danger"}>
                            {row.closedAt ? `Closed · ${row.status}` : `Open · ${row.status}`}
                          </StatusPill>
                        </div>
                        <div className="mt-3">
                          <DataList>
                            <DataRow label="Dispute" value={row.id} />
                            <DataRow label="Booking" value={row.bookingId ?? "Not matched to a booking"} />
                            <DataRow label="Opened" value={when(row.createdAt)} />
                            <DataRow label="Closed" value={row.closedAt ? when(row.closedAt) : "Still open"} />
                          </DataList>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- heartbeats --------------------------------------- */}
            <section aria-labelledby="jobs-heading" className="flex flex-col gap-4">
              <h2 id="jobs-heading" className="m-0 text-card-title">
                Scheduled jobs
              </h2>
              <p className="m-0 max-w-reading text-sm text-ink-secondary">
                Each job writes a heartbeat when it runs. Stale means it hasn't reported recently —
                which for expire-pending means abandoned checkouts are still holding dates.
              </p>
              {data.heartbeats.length === 0 ? (
                <EmptyState title="No job has reported yet.">
                  <p>A job writes its first row the first time it runs.</p>
                </EmptyState>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {data.heartbeats.map((row) => (
                    <li key={row.job}>
                      <Card padding="sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="m-0 font-semibold">{row.job}</p>
                          <StatusPill tone={row.errored || row.stale ? "danger" : "brand"}>
                            {row.errored ? "Errored" : row.stale ? "Stale" : "Healthy"}
                          </StatusPill>
                        </div>
                        <div className="mt-3">
                          <DataList>
                            <DataRow label="Last success" value={when(row.lastOk)} />
                            {row.lastError ? <DataRow label="Last error" value={row.lastError} /> : null}
                          </DataList>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- conversion totals -------------------------------- */}
            <section aria-labelledby="conversions-heading" className="flex flex-col gap-4">
              <h2 id="conversions-heading" className="m-0 text-card-title">
                Conversion totals
              </h2>
              <p className="m-0 max-w-reading text-sm text-ink-secondary">
                Counts of durable outcomes the server recorded next to the transition that caused
                them. Lifetime facts are unique per member, so a retry or a replayed webhook cannot
                inflate them. These are counts, never rows — who activated is not shown here.
              </p>
              {data.conversions.length === 0 ? (
                <EmptyState title="No conversions recorded yet.">
                  <p>A fact appears the first time a member confirms a stay or readies a home.</p>
                </EmptyState>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {data.conversions.map((row) => (
                    <li key={row.outcome}>
                      <Card padding="sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="m-0 font-semibold">{row.outcome.replaceAll("_", " ")}</p>
                          <p className="money m-0 text-lg font-semibold">{row.total}</p>
                        </div>
                        <div className="mt-3">
                          <DataList>
                            <DataRow label="First" value={when(row.firstAt)} />
                            <DataRow label="Most recent" value={when(row.lastAt)} />
                          </DataList>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- frozen payouts ----------------------------------- */}
            <section aria-labelledby="frozen-heading" className="flex flex-col gap-4">
              <h2 id="frozen-heading" className="m-0 text-card-title">
                Frozen payouts
              </h2>
              <p className="m-0 max-w-reading text-sm text-ink-secondary">
                A payout freezes when a dispute opens on its booking and unfreezes when that dispute
                closes in the platform's favour. Both transitions are the webhook's, not this page's.
              </p>
              {data.frozenPayouts.length === 0 ? (
                <EmptyState title="Nothing frozen." />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {data.frozenPayouts.map((row) => (
                    <li key={row.id}>
                      <Card padding="sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="money m-0 font-semibold">{formatUsd(row.amountCents)}</p>
                          <StatusPill tone="danger">Frozen</StatusPill>
                        </div>
                        <div className="mt-3">
                          <DataList>
                            <DataRow label="Booking" value={row.bookingId} />
                            <DataRow label="Paid at" value={when(row.paidAt)} />
                          </DataList>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
