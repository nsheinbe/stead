import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { TrustPassportCard } from "../components/TrustPassportCard";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { prettyDay } from "../lib/dates";
import { stripePublishableKey } from "../lib/env";
import {
  formatPct,
  formatRating,
  statOrAbsent,
  verificationDetail,
  verificationLabel,
} from "../lib/passport";
import type { PublishedReview, TrustStats } from "../lib/types";

/**
 * A rating as a number first.
 *
 * Stars alone are a picture of a number; the number is the fact. Screen
 * readers and anyone comparing two profiles get the digits, and the stars are
 * decoration beside them.
 */
function Rating({ value }: { value: number }) {
  return (
    <p className="m-0 flex items-center gap-2">
      <span className="money font-semibold">{value.toFixed(1)} out of 5</span>
      <span aria-hidden className="text-brass">
        {"★".repeat(Math.round(value))}
        <span className="text-brass/30">{"★".repeat(5 - Math.round(value))}</span>
      </span>
    </p>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">{label}</p>
      <p className="money m-0 text-lg font-semibold">{value}</p>
      {hint ? <p className="m-0 text-sm text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

function ReviewCard({ review }: { review: PublishedReview }) {
  return (
    <Card as="li">
      <Rating value={review.rating} />
      {review.body ? (
        <p className="mb-0 mt-3 max-w-reading whitespace-pre-line text-ink-secondary">{review.body}</p>
      ) : (
        <p className="mb-0 mt-3 text-sm text-ink-secondary">This review has a rating but no written note.</p>
      )}
      <p className="m-0 mt-4 text-sm text-ink-secondary">
        {review.authorName} · {review.nights} nights in {review.city} · checked out{" "}
        {prettyDay(review.checkOut)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* The receipt is what makes this a record of a real stay, so it is
            stated as a fact about the booking rather than a badge. */}
        <StatusPill>Booked through Stead · receipt {review.receipt}</StatusPill>
        <StatusPill>
          {review.direction === "host_reviews_guest" ? "Host reviewing a guest" : "Guest reviewing a host"}
        </StatusPill>
      </div>
    </Card>
  );
}

/**
 * A member's profile.
 *
 * The page shows history, not a promise. Every statistic renders exactly what
 * the server returned: a member with no completed stays has no average rating,
 * which is not a rating of zero and never displays as one. Verification says
 * which checks were completed and nothing about what those checks guarantee.
 */
export function PassportPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwn = Boolean(user && userId && user.id === userId);
  const identityConfigured = Boolean(stripePublishableKey());

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
      a.download = `stead-profile-${userId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return signed;
    },
  });

  const data = passport.data;
  const notFound = passport.error instanceof ApiError && passport.error.status === 404;

  if (passport.isPending) {
    return (
      <Shell width="narrow" title="Member profile">
        <div className="flex flex-1 flex-col gap-6 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this profile
          </p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell width="narrow" title="Member profile">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="We couldn't find this profile."
            description="That member may not exist, or the link may be out of date."
          />
          <ButtonLink to="/explore" className="self-start">
            Find a home
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  if (passport.isError) {
    return (
      <Shell width="narrow" title="Member profile">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <StatusMessage
            tone="danger"
            title="We couldn't load this profile."
            action={
              <Button variant="secondary" size="sm" onClick={() => void passport.refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      </Shell>
    );
  }

  const stats: TrustStats = data.stats;

  return (
    <Shell width="narrow" title="Member profile">
      <div className="flex flex-1 flex-col gap-8 py-6 sm:py-8">
        <TrustPassportCard passport={data} />

        {/* --- what we actually know -------------------------------- */}
        <section aria-labelledby="history-heading" className="flex flex-col gap-4">
          <h2 id="history-heading" className="m-0 text-card-title">
            Stay history
          </h2>
          <Card>
            <div className="grid gap-6 sm:grid-cols-2">
              <Metric label="Stays completed" value={String(stats.staysCompleted)} />
              <Metric
                label="Published reviews"
                value={String(stats.reviewCount)}
                hint="Each one is tied to a stay booked through Stead."
              />
              <Metric
                label="Rating as a guest"
                value={statOrAbsent(stats.avgRatingAsGuest, (n) => `${formatRating(n)} out of 5`)}
              />
              <Metric
                label="Rating as a host"
                value={statOrAbsent(stats.avgRatingAsHost, (n) => `${formatRating(n)} out of 5`)}
              />
              <Metric
                label="Stays with no damage claim"
                value={String(stats.damageFreeStreak)}
                hint="Consecutive, most recent first."
              />
              <Metric
                label="Stays this member canceled as host"
                value={String(stats.hostCancellations)}
              />
              <Metric
                label="Message response rate"
                value={statOrAbsent(stats.responseRate, (n) => formatPct(n))}
              />
            </div>
          </Card>
        </section>

        {/* --- verification ----------------------------------------- */}
        <section aria-labelledby="verification-heading" className="flex flex-col gap-4">
          <h2 id="verification-heading" className="m-0 text-card-title">
            Verification
          </h2>
          <Card>
            <p className="m-0 font-semibold">{verificationLabel(stats.verificationTier)}</p>
            <p className="mb-0 mt-2 max-w-reading text-ink-secondary">
              {verificationDetail(stats.verificationTier)}
            </p>
            <p className="mb-0 mt-3 max-w-reading text-sm text-ink-secondary">
              Verification records which checks a member completed. It isn't a guarantee about how a stay
              will go, and it doesn't vouch for anyone.
            </p>

            {isOwn && stats.verificationTier < 2 ? (
              <div className="mt-5 flex flex-col gap-3 border-t border-divider pt-5">
                <p className="m-0 font-semibold">Add a government ID check</p>
                <p className="m-0 max-w-reading text-sm text-ink-secondary">
                  Stripe runs the check and tells us the result. It appears here once the check completes.
                </p>
                {identityConfigured ? (
                  <Button
                    className="self-start"
                    busy={verifyId.isPending}
                    busyLabel="Opening Stripe…"
                    onClick={() => verifyId.mutate()}
                  >
                    Verify your ID
                  </Button>
                ) : (
                  <StatusMessage
                    tone="info"
                    live={false}
                    title="ID verification isn't available on this deployment."
                  >
                    <p>Nothing is wrong with your account — the check isn't configured here.</p>
                  </StatusMessage>
                )}
                {verifyId.isError ? (
                  <StatusMessage
                    tone="danger"
                    title={
                      verifyId.error instanceof ApiError
                        ? verifyId.error.message
                        : "We couldn't start the ID check. Please try again."
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </Card>
        </section>

        {/* --- reviews ---------------------------------------------- */}
        <section aria-labelledby="reviews-heading" className="flex flex-col gap-4">
          <h2 id="reviews-heading" className="m-0 text-card-title">
            {stats.reviewCount === 1 ? "1 published review" : `${stats.reviewCount} published reviews`}
          </h2>
          {data.reviews.length === 0 ? (
            <EmptyState title="No reviews published yet.">
              <p>
                A review publishes once both sides have written one, or once the window closes. Until then
                neither side sees the other's.
              </p>
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {data.reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          )}
        </section>

        {/* --- explainer and owner tools ---------------------------- */}
        <Surface>
          <h2 className="m-0 text-card-title">About this profile</h2>
          <p className="mb-0 mt-3 max-w-reading text-ink-secondary">
            Everything here comes from stays booked through Stead: completed stays, reviews written after
            checkout, and claims raised against a deposit. A review cannot be written by someone who
            wasn't on the booking, and it can't be removed by the person it's about.
          </p>
          <p className="mb-0 mt-3 max-w-reading text-ink-secondary">
            It is a record of activity here, not a background check, and it says nothing about stays
            elsewhere.
          </p>

          {isOwn ? (
            <div className="mt-5 flex flex-col gap-3 border-t border-divider pt-5">
              <p className="m-0 font-semibold">Take your record with you</p>
              <p className="m-0 max-w-reading text-sm text-ink-secondary">
                Download your history as a signed JSON file. The signature lets anyone you give it to check
                that Stead produced it and that nothing in it was altered.
              </p>
              <Button
                variant="secondary"
                className="self-start"
                busy={exportPass.isPending}
                busyLabel="Preparing your file…"
                onClick={() => exportPass.mutate()}
              >
                Download your signed record
              </Button>
              {exportPass.isError ? (
                <StatusMessage
                  tone="danger"
                  title={
                    exportPass.error instanceof ApiError
                      ? exportPass.error.message
                      : "We couldn't prepare that file. Please try again."
                  }
                />
              ) : null}
              {exportPass.isSuccess ? (
                <StatusMessage tone="success" title="Your signed record has downloaded." />
              ) : null}
            </div>
          ) : null}
        </Surface>
      </div>
    </Shell>
  );
}
