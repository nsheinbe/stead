import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { prettyDay } from "../lib/dates";
import { GUEST_REVIEW_TAGS, HOST_REVIEW_TAGS } from "../lib/types";

function StarButton({
  filled,
  onSelect,
  label,
}: {
  filled: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onSelect}
      className="p-0.5"
    >
      <svg width="38" height="36" viewBox="0 0 17 16" aria-hidden>
        <path
          d="M8.5 0.8 L10.6 5.6 L15.8 6.1 L11.9 9.6 L13 14.7 L8.5 12.1 L4 14.7 L5.1 9.6 L1.2 6.1 L6.4 5.6 Z"
          fill={filled ? "#B58B3E" : "rgba(181,139,62,.28)"}
        />
      </svg>
    </button>
  );
}

export function ReviewPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user, loading, status } = useAuth();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");

  const form = useQuery({
    queryKey: ["review", bookingId],
    enabled: Boolean(user) && Boolean(bookingId),
    queryFn: () => api.reviewForm(bookingId as string),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () =>
      api.submitReview(bookingId as string, { rating, tags, body: body.trim() }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["review", bookingId], next);
      await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
    },
  });

  const data = form.data;
  const notFound = form.error instanceof ApiError && form.error.status === 404;
  const presets = data?.viewerRole === "host" ? HOST_REVIEW_TAGS : GUEST_REVIEW_TAGS;
  const headline =
    data?.viewerRole === "host" ? "How was your guest?" : `How was ${data?.listingTitle ?? "the stay"}?`;

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        {loading || form.isLoading ? <StatusBanner title="Opening the review…" /> : null}
        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to write this review"
            description="Reviews are only for stays you were on. We'll bring you back to this one."
          />
        ) : null}
        {user && notFound ? (
          <StatusBanner title="No stay here" detail="Reviews are only for stays you were on." />
        ) : null}

        {data ? (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-display text-2xl font-semibold">{headline}</h1>
              <span className="text-[12.5px] text-ink/55">
                Checked out {prettyDay(data.checkOut)} · receipt #{data.receipt}
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-[14px] bg-linen px-4 py-3.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
                <path
                  d="M3 12 C3 12 6.5 5.5 12 5.5 C17.5 5.5 21 12 21 12 C21 12 17.5 18.5 12 18.5 C6.5 18.5 3 12 3 12 Z"
                  stroke="#1E4034"
                  strokeWidth="1.7"
                />
                <path d="M4 20 L20 4" stroke="#1E4034" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <span className="text-[13px] leading-snug text-ink/75">
                <b>Double-blind:</b> the other side cannot read yours until theirs is in — or 14 days
                pass. Then both publish at once.
              </span>
            </div>

            {!data.stayCompleted ? (
              <StatusBanner title="Reviews open after checkout" />
            ) : null}

            {data.mine ? (
              <StatusBanner
                title={
                  data.mine.publishedAt
                    ? "Published — both sides are in"
                    : "Your review is in"
                }
                detail={
                  data.mine.publishedAt
                    ? "Permanent, and tied to the booking receipt."
                    : "It publishes when the other side writes theirs, or 14 days after checkout."
                }
              />
            ) : null}

            {data.canSubmit ? (
              <form
                className="flex flex-col gap-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
              >
                <div className="flex justify-center gap-2.5 py-2" role="group" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <StarButton
                      key={n}
                      filled={n <= rating}
                      onSelect={() => setRating(n)}
                      label={`${n} star${n === 1 ? "" : "s"}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {presets.map((tag) => {
                    const on = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={
                          on
                            ? "rounded-full bg-spruce px-[15px] py-2 text-[12.5px] font-bold text-paper"
                            : "rounded-full border border-[#D8CDB6] px-[15px] py-2 text-[12.5px] font-semibold text-ink/70"
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="sr-only">Review</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    maxLength={4000}
                    placeholder="What should the next person know?"
                    className="rounded-[14px] border border-linen-tint px-4 py-3.5 text-sm leading-relaxed text-ink"
                  />
                </label>
                <p className="m-0 text-center text-[11.5px] text-ink/50">
                  Permanent once published · tied to your booking receipt
                </p>
                {submit.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not publish that review"
                    detail={submit.error instanceof ApiError ? submit.error.message : undefined}
                  />
                ) : null}
                <button
                  type="submit"
                  disabled={submit.isPending}
                  className="rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep disabled:opacity-60"
                >
                  {submit.isPending ? "Publishing…" : "Publish review"}
                </button>
              </form>
            ) : null}

            {data.published.length > 0 ? (
              <div className="flex flex-col gap-3">
                {data.published.map((review) => (
                  <div key={review.id} className="flex flex-col gap-2 rounded-card bg-linen p-4">
                    <span className="text-sm font-bold">
                      {review.authorName} · {review.rating}★
                    </span>
                    {review.body ? (
                      <p className="m-0 text-sm leading-relaxed text-ink/80">{review.body}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <Link to={`/trips/${data.bookingId}`} className="text-sm font-bold no-underline">
              Back to the stay →
            </Link>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
