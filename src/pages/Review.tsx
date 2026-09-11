import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  PageHeader,
  Skeleton,
  StatusMessage,
  Surface,
  Textarea,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { prettyDay } from "../lib/dates";
import { ratingLabel, REVIEW_AFTER_SUBMIT, REVIEW_BLIND_RULE } from "../lib/reviews";
import { GUEST_REVIEW_TAGS, HOST_REVIEW_TAGS } from "../lib/types";

/**
 * The rating control.
 *
 * A radio group, not a row of buttons: five mutually exclusive options with a
 * name, arrow-key movement and a value that is announced. Each option carries
 * its number and what that number means, so the choice is legible without
 * counting stars.
 */
function RatingChoice({ value, onChange }: { value: number | null; onChange: (next: number) => void }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 text-sm font-semibold text-ink">Your rating</legend>
      <div className="flex flex-col gap-1">
        {[5, 4, 3, 2, 1].map((n) => (
          <label
            key={n}
            htmlFor={`rating-${n}`}
            className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control px-3 ${
              value === n ? "bg-surface-accent" : ""
            }`}
          >
            <input
              id={`rating-${n}`}
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="h-5 w-5 shrink-0 accent-brand"
            />
            <span className="money font-semibold">{n}</span>
            <span aria-hidden className="text-brass">
              {"★".repeat(n)}
              <span className="text-brass/25">{"★".repeat(5 - n)}</span>
            </span>
            <span className="text-ink-secondary">{ratingLabel(n)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ReviewPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [ratingError, setRatingError] = useState<string | null>(null);

  const form = useQuery({
    queryKey: ["review", bookingId],
    enabled: Boolean(user) && Boolean(bookingId),
    queryFn: () => api.reviewForm(bookingId as string),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: (chosen: number) =>
      api.submitReview(bookingId as string, { rating: chosen, tags, body: body.trim() }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["review", bookingId], next);
      await queryClient.invalidateQueries({ queryKey: ["trip", bookingId] });
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });

  const data = form.data;
  const notFound = form.error instanceof ApiError && form.error.status === 404;

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" title="Write a review">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to write this review"
            description="A review can only be written by someone who was on the stay. We'll bring you back to this one."
          />
        </div>
      </Shell>
    );
  }

  if (form.isPending) {
    return (
      <Shell width="narrow" title="Write a review">
        <div className="flex flex-1 flex-col gap-4 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Opening this review
          </p>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-56 w-full" />
        </div>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell width="narrow" title="Write a review">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="There's no review to write here."
            description="Reviews belong to stays you were on, and open after checkout."
          />
          <ButtonLink to="/trips" className="self-start">
            Your stays
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const presets = data.viewerRole === "host" ? HOST_REVIEW_TAGS : GUEST_REVIEW_TAGS;
  const headline = data.viewerRole === "host" ? "How was your guest?" : `How was ${data.listingTitle}?`;

  return (
    <Shell width="narrow" title="Write a review" backTo={`/trips/${data.bookingId}`} backLabel="This stay">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <PageHeader
          title={headline}
          description={`${data.nights} nights in ${data.city} · checked out ${prettyDay(data.checkOut)}`}
        />

        <Surface padding="sm">
          <p className="m-0 text-sm text-ink-secondary">{REVIEW_BLIND_RULE}</p>
          <p className="m-0 mt-2 text-sm text-ink-secondary">
            This review is attached to booking receipt {data.receipt}, so it can only be written by
            someone who was on that stay — and the person it's about can't remove it.
          </p>
        </Surface>

        {!data.stayCompleted ? (
          <StatusMessage tone="info" live={false} title="This review opens after checkout.">
            <p>Come back once the stay is finished and you'll be able to write it.</p>
          </StatusMessage>
        ) : null}

        {data.mine ? (
          <StatusMessage
            tone={data.mine.publishedAt ? "success" : "info"}
            live={false}
            title={data.mine.publishedAt ? "Your review is published." : "Your review is saved."}
          >
            <p>
              {data.mine.publishedAt
                ? "Both sides are in, so both reviews are on the profiles now."
                : REVIEW_AFTER_SUBMIT}
            </p>
          </StatusMessage>
        ) : null}

        {data.canSubmit ? (
          <form
            className="flex flex-col gap-6"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (rating === null) {
                setRatingError("Choose a rating from 1 to 5.");
                return;
              }
              setRatingError(null);
              submit.mutate(rating);
            }}
          >
            <Card>
              <RatingChoice
                value={rating}
                onChange={(next) => {
                  setRating(next);
                  setRatingError(null);
                }}
              />
              {ratingError ? (
                <p role="alert" className="m-0 mt-3 text-sm font-semibold text-danger">
                  {ratingError}
                </p>
              ) : null}
            </Card>

            <Card>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-1 text-sm font-semibold text-ink">What stood out</legend>
                <p className="m-0 mb-3 text-sm text-ink-secondary">Optional. Choose any that apply.</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((tag) => {
                    const on = tags.includes(tag);
                    return (
                      <label
                        key={tag}
                        className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold ${
                          on ? "border-brand bg-surface-accent text-brand" : "border-control text-ink"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleTag(tag)}
                          className="h-4 w-4 accent-brand"
                        />
                        {tag}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </Card>

            <Textarea
              id="review-body"
              label="What should the next person know?"
              optional
              rows={6}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            {submit.isError ? (
              <StatusMessage tone="danger" title="Your review wasn't saved.">
                <p>
                  {submit.error instanceof ApiError
                    ? submit.error.message
                    : "Something went wrong on the way to the server."}{" "}
                  What you wrote is still here.
                </p>
              </StatusMessage>
            ) : null}

            <div className="flex flex-col gap-3">
              {/* Submitting is not publishing. The server publishes both sides
                  together, later — so the button says what this click does. */}
              <Button
                type="submit"
                className="self-start"
                busy={submit.isPending}
                busyLabel="Saving your review…"
              >
                Submit your review
              </Button>
              <p className="m-0 text-sm text-ink-secondary">{REVIEW_AFTER_SUBMIT}</p>
            </div>
          </form>
        ) : null}

        {data.published.length > 0 ? (
          <section aria-labelledby="published-heading" className="flex flex-col gap-4">
            <h2 id="published-heading" className="m-0 text-card-title">
              Published for this stay
            </h2>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {data.published.map((review) => (
                <Card as="li" key={review.id}>
                  <p className="m-0">
                    <span className="money font-semibold">{review.rating} out of 5</span>
                    <span className="text-ink-secondary"> · {review.authorName}</span>
                  </p>
                  {review.body ? (
                    <p className="mb-0 mt-3 max-w-reading whitespace-pre-line text-ink-secondary">
                      {review.body}
                    </p>
                  ) : null}
                </Card>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
