import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { formatUsd } from "../lib/money";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export function OpsPage() {
  const { user, loading } = useAuth();

  const ops = useQuery({
    queryKey: ["ops"],
    enabled: Boolean(user),
    queryFn: () => api.ops(),
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 1,
  });

  const forbidden = ops.error instanceof ApiError && ops.error.status === 403;

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-4 pb-6 pt-6">
        <div className="flex items-baseline justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Ops</h1>
          <Link to="/" className="text-sm font-bold text-spruce no-underline">
            Home
          </Link>
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-ink/60">
          Disputes, stale heartbeats, frozen payouts. Utilitarian on purpose — there is no
          designed admin screen.
        </p>

        {loading ? <StatusBanner title="Checking your session…" /> : null}
        {!loading && !user ? <StatusBanner title="Sign in to continue" /> : null}
        {forbidden ? (
          <StatusBanner tone="claim" title="This page is for ops" detail="Your account is not flagged." />
        ) : null}
        {ops.isError && !forbidden ? (
          <StatusBanner tone="claim" title="Could not load ops" />
        ) : null}
        {ops.isLoading ? <StatusBanner title="Loading ops…" /> : null}

        {ops.data ? (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="m-0 font-display text-lg font-semibold">Disputes</h2>
              {ops.data.disputes.length === 0 ? (
                <StatusBanner title="No chargebacks on record" />
              ) : (
                ops.data.disputes.map((row) => (
                  <div
                    key={row.id}
                    className={`flex flex-col gap-1 rounded-card border px-4 py-3 ${
                      row.closedAt ? "border-linen-tint" : "border-claim/40 bg-claim/[0.04]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="money text-sm font-bold">{formatUsd(row.amountCents)}</span>
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink/50">
                        {row.status}
                      </span>
                    </div>
                    <span className="text-xs text-ink/55">
                      {row.id}
                      {row.bookingId ? ` · booking ${row.bookingId.slice(0, 8)}` : ""}
                    </span>
                    <span className="text-xs text-ink/55">
                      Opened {when(row.createdAt)}
                      {row.closedAt ? ` · closed ${when(row.closedAt)}` : " · open"}
                    </span>
                  </div>
                ))
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="m-0 font-display text-lg font-semibold">Heartbeats</h2>
              {ops.data.heartbeats.length === 0 ? (
                <StatusBanner title="No heartbeats yet" detail="Jobs write a row the first time they run." />
              ) : (
                ops.data.heartbeats.map((row) => (
                  <div
                    key={row.job}
                    className={`flex flex-col gap-1 rounded-card border px-4 py-3 ${
                      row.errored || row.stale ? "border-claim/40 bg-claim/[0.04]" : "border-linen-tint"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold">{row.job}</span>
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink/50">
                        {row.errored ? "Errored" : row.stale ? "Stale" : "Ok"}
                      </span>
                    </div>
                    <span className="text-xs text-ink/55">Last ok {when(row.lastOk)}</span>
                    {row.lastError ? (
                      <span className="text-xs text-claim">{row.lastError}</span>
                    ) : null}
                  </div>
                ))
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="m-0 font-display text-lg font-semibold">Frozen payouts</h2>
              {ops.data.frozenPayouts.length === 0 ? (
                <StatusBanner title="Nothing frozen" />
              ) : (
                ops.data.frozenPayouts.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-card border border-claim/40 bg-claim/[0.04] px-4 py-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="money text-sm font-bold">{formatUsd(row.amountCents)}</span>
                      <span className="text-xs text-ink/55">
                        Booking {row.bookingId.slice(0, 8)} · {when(row.paidAt)}
                      </span>
                    </div>
                    <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-claim">
                      Frozen
                    </span>
                  </div>
                ))
              )}
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
