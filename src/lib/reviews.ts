/**
 * Review publication, stated the way the database actually does it.
 *
 * Both sides' reviews publish together — when the second one is written, or
 * once the window since listing-local checkout has passed. That window is a
 * constant inside `app.publish_due_reviews` (see `drizzle/0008_reviews.sql`),
 * not a configurable value, so it is mirrored here rather than fetched.
 *
 * Nothing here calls a review permanent. Submitting is not publishing, and a
 * button that says "publish" when the server will not publish for two weeks is
 * simply wrong.
 */
export const REVIEW_PUBLISH_WINDOW_DAYS = 14;

export const REVIEW_BLIND_RULE =
  `Neither side sees the other's review until both are written, or until ${REVIEW_PUBLISH_WINDOW_DAYS} days after checkout. Then both appear at once.`;

/** What happens next to a review that has been written but not yet published. */
export const REVIEW_AFTER_SUBMIT =
  `Your review is saved. It appears on both profiles when the other side writes theirs, or ${REVIEW_PUBLISH_WINDOW_DAYS} days after checkout.`;

export function ratingLabel(rating: number): string {
  const words: Record<number, string> = {
    1: "Poor",
    2: "Below expectations",
    3: "Fine",
    4: "Good",
    5: "Excellent",
  };
  return words[rating] ?? "";
}
