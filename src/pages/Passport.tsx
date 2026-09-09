import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { TrustPassportCard } from "../components/TrustPassportCard";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { prettyDay } from "../lib/dates";
import { stripePublishableKey } from "../lib/env";

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width="17" height="16" viewBox="0 0 17 16" aria-hidden>
          <path
            d="M8.5 0.8 L10.6 5.6 L15.8 6.1 L11.9 9.6 L13 14.7 L8.5 12.1 L4 14.7 L5.1 9.6 L1.2 6.1 L6.4 5.6 Z"
            fill={i < rating ? "#B58B3E" : "rgba(181,139,62,.28)"}
          />
        </svg>
      ))}
    </div>
  );
}

export function PassportPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwn = Boolean(user && userId && user.id === userId);
  const identityReady = Boolean(stripePublishableKey());

  const passport = useQuery({
    queryKey: ["passport", userId],
    enabled: Boolean(userId),
    queryFn: () => api.passport(userId as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const verifyId = useMutation({
    mutationFn: () => api.startIdentity(),
    onSuccess: (result) => {
      if (result.alreadyVerified) {
        void queryClient.invalidateQueries({ queryKey: ["passport", userId] });
        return;
      }
      if (result.url) window.location.href = result.url;
    },
  });

  const exportPass = useMutation({
    mutationFn: async () => {
      const signed = await api.exportPassport(userId as string);
      const blob = new Blob([JSON.stringify(signed, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stead-trust-passport-${userId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return signed;
    },
  });

  const data = passport.data;
  const notFound = passport.error instanceof ApiError && passport.error.status === 404;
  const latest = data?.reviews[0];

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-3.5 bg-spruce px-[18px] pb-6 pt-16 text-paper md:rounded-card md:pt-6">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Trust Passport</h1>
          {isOwn ? (
            <button
              type="button"
              onClick={() => exportPass.mutate()}
              disabled={exportPass.isPending || !data}
              aria-label="Export signed Trust Passport"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-paper/40 text-paper disabled:opacity-60"
            >
              <svg width="15" height="17" viewBox="0 0 18 20" fill="none" aria-hidden>
                <path
                  d="M9 12 V2 M5.5 5 L9 1.5 L12.5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 9 H2.5 V18.5 H15.5 V9 H14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>

        {passport.isLoading ? <StatusBanner title="Loading this passport…" /> : null}
        {notFound ? <StatusBanner title="No passport here" detail="That member may not exist." /> : null}
        {passport.isError && !notFound ? (
          <StatusBanner tone="claim" title="Could not load this passport" />
        ) : null}
        {exportPass.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not export"
            detail={exportPass.error instanceof ApiError ? exportPass.error.message : undefined}
          />
        ) : null}
        {verifyId.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not start ID verification"
            detail={verifyId.error instanceof ApiError ? verifyId.error.message : undefined}
          />
        ) : null}

        {data ? (
          <>
            <TrustPassportCard passport={data} />

            {isOwn && data.stats.verificationTier < 2 ? (
              <div className="flex flex-col gap-2 rounded-card border border-brass/40 bg-paper/10 px-4 py-3">
                <span className="text-sm font-bold text-paper">Raise your verification to tier 2</span>
                <p className="m-0 text-[12.5px] leading-relaxed text-paper/75">
                  Stripe Identity checks a government ID. Email is tier 0; a verified phone is
                  tier 1; a verified ID is tier 2. It lands on this passport once the check
                  completes.
                </p>
                {identityReady ? (
                  <button
                    type="button"
                    onClick={() => verifyId.mutate()}
                    disabled={verifyId.isPending}
                    className="self-start rounded-full bg-brass px-4 py-2 text-sm font-bold text-ink disabled:opacity-60"
                  >
                    {verifyId.isPending ? "Opening Stripe…" : "Verify your ID"}
                  </button>
                ) : (
                  <p className="m-0 text-[12.5px] text-paper/65">
                    ID verification is not configured on this deployment.
                  </p>
                )}
              </div>
            ) : null}

            <div className="flex justify-around px-2 pt-1">
              <div className="flex flex-col items-center gap-1.5">
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-[1.5px] border-brass-light text-[17px] font-bold text-brass-light outline outline-1 outline-offset-[3px] outline-brass-light/40">
                  {data.stats.damageFreeStreak}
                </span>
                <span className="text-[10px] font-semibold tracking-[0.06em] text-paper/65">STREAK</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-[1.5px] border-brass-light outline outline-1 outline-offset-[3px] outline-brass-light/40">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M3.5 10.6 L12 3.4 L20.5 10.6 V20.5 H3.5 Z"
                      stroke="#DDB672"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="13.2" r="1.8" fill="#DDB672" />
                  </svg>
                </span>
                <span className="text-[10px] font-semibold tracking-[0.06em] text-paper/65">
                  {data.isHost ? "HOSTS TOO" : "TRAVELS"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-[1.5px] border-brass-light text-[14px] font-bold text-brass-light outline outline-1 outline-offset-[3px] outline-brass-light/40"
                  data-testid="host-cancellations-badge"
                >
                  {data.stats.hostCancellations}
                </span>
                <span className="text-[10px] font-semibold tracking-[0.06em] text-paper/65">HOST CANCELS</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-paper/15 bg-paper/10 px-3.5 py-3">
              <span className="flex-1 text-[12.5px] leading-snug text-paper/80">
                {data.stats.reviewCount}{" "}
                {data.stats.reviewCount === 1 ? "review" : "reviews"}, each tied to a receipt.
                {latest
                  ? ` Latest: ${latest.authorName}, ${latest.rating}★, ${prettyDay(latest.checkOut)}.`
                  : " None published yet."}
              </span>
            </div>

            {data.reviews.length > 0 ? (
              <div className="flex flex-col gap-3">
                {data.reviews.map((review) => (
                  <div
                    key={review.id}
                    className="flex flex-col gap-3 rounded-card bg-paper p-[18px] text-ink"
                  >
                    <StarRow rating={review.rating} />
                    {review.body ? (
                      <p className="m-0 text-sm leading-relaxed text-ink/85">“{review.body}”</p>
                    ) : null}
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-linen text-[15px] font-bold text-spruce">
                        {review.authorName
                          .split(/\s+/)
                          .map((p) => p[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-[15px] font-bold">{review.authorName}</span>
                        <span className="text-[13.5px] text-ink/55">
                          {review.nights} nights · {review.city} · {prettyDay(review.checkOut)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-linen px-2.5 py-1.5 text-[12.5px] font-semibold">
                        Verified stay · Receipt #{review.receipt}
                      </span>
                      <span className="rounded-full border border-[#DDD3BE] px-2.5 py-1.5 text-[12.5px] font-semibold text-ink/65">
                        {review.direction === "host_reviews_guest" ? "Host → guest" : "Double-blind"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {!isOwn && userId ? (
              <Link to="/explore" className="text-sm font-bold text-brass-light no-underline">
                Find a stay →
              </Link>
            ) : null}
          </>
        ) : null}
      </div>
    </Shell>
  );
}
