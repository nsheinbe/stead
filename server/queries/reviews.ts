/**
 * Reviews, Slice 4.
 *
 * Writes go through SECURITY DEFINER: app_user has no INSERT/UPDATE on reviews,
 * so submit / publish are the only way a row appears or gains published_at.
 * Reads are scoped by RLS — published is public, drafts are the author's.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import type { PublishedReview, ReviewDirection, ReviewForm } from "../../src/lib/types";

function receiptFor(bookingId: string): string {
  return `S-${bookingId.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
}

function mapPublished(row: {
  id: string;
  booking_id: string;
  author_id: string;
  subject_id: string;
  direction: string;
  rating: number;
  tags: string[] | null;
  body: string;
  submitted_at: string;
  published_at: string;
  author_name: string;
  nights: number;
  city: string;
  check_out: string;
}): PublishedReview {
  return {
    id: row.id,
    bookingId: row.booking_id,
    authorId: row.author_id,
    subjectId: row.subject_id,
    direction: row.direction as ReviewDirection,
    rating: Number(row.rating),
    tags: row.tags ?? [],
    body: row.body,
    submittedAt: new Date(row.submitted_at).toISOString(),
    publishedAt: new Date(row.published_at).toISOString(),
    authorName: row.author_name,
    nights: Number(row.nights),
    city: row.city,
    checkOut: row.check_out,
    receipt: receiptFor(row.booking_id),
  };
}

export async function getReviewForm(
  tx: Tx,
  bookingId: string,
  viewerId: string,
): Promise<ReviewForm | null> {
  const rows = (await tx.execute(sql`
    SELECT b.id, b.status::text AS status, b.check_out, b.nights, b.guest_id, l.host_id,
           l.title AS listing_title, l.city, l.timezone
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
     WHERE b.id = ${bookingId}::uuid
       AND (b.guest_id = ${viewerId}::uuid OR l.host_id = ${viewerId}::uuid)
  `)) as unknown as {
    id: string;
    status: string;
    check_out: string;
    nights: number;
    guest_id: string;
    host_id: string;
    listing_title: string;
    city: string;
    timezone: string;
  }[];
  const row = rows[0];
  if (!row) return null;

  const direction: ReviewDirection =
    row.guest_id === viewerId ? "guest_reviews_host" : "host_reviews_guest";

  const own = (await tx.execute(sql`
    SELECT id, rating, tags, body, submitted_at, published_at
      FROM public.reviews
     WHERE booking_id = ${bookingId}::uuid AND author_id = ${viewerId}::uuid
     LIMIT 1
  `)) as unknown as {
    id: string;
    rating: number;
    tags: string[] | null;
    body: string;
    submitted_at: string;
    published_at: string | null;
  }[];

  const published = (await tx.execute(sql`
    SELECT r.id, r.booking_id, r.author_id, r.subject_id, r.direction::text AS direction,
           r.rating, r.tags, r.body, r.submitted_at, r.published_at,
           p.display_name AS author_name, b.nights, l.city, b.check_out
      FROM public.reviews r
      JOIN public.bookings b ON b.id = r.booking_id
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.profiles p ON p.id = r.author_id
     WHERE r.booking_id = ${bookingId}::uuid AND r.published_at IS NOT NULL
     ORDER BY r.direction ASC
  `)) as unknown as {
    id: string;
    booking_id: string;
    author_id: string;
    subject_id: string;
    direction: string;
    rating: number;
    tags: string[] | null;
    body: string;
    submitted_at: string;
    published_at: string;
    author_name: string;
    nights: number;
    city: string;
    check_out: string;
  }[];

  const mine = own[0];
  return {
    bookingId: row.id,
    listingTitle: row.listing_title,
    city: row.city,
    timezone: row.timezone,
    checkOut: row.check_out,
    nights: Number(row.nights),
    receipt: receiptFor(row.id),
    direction,
    viewerRole: row.guest_id === viewerId ? "guest" : "host",
    stayCompleted: row.status === "completed",
    canSubmit: row.status === "completed" && !mine,
    mine: mine
      ? {
          id: mine.id,
          rating: Number(mine.rating),
          tags: mine.tags ?? [],
          body: mine.body,
          submittedAt: new Date(mine.submitted_at).toISOString(),
          publishedAt: mine.published_at ? new Date(mine.published_at).toISOString() : null,
        }
      : null,
    published: published.map(mapPublished),
  };
}

export async function getTripReviewState(
  tx: Tx,
  bookingId: string,
  viewerId: string,
): Promise<{ canReview: boolean; submitted: boolean; published: boolean }> {
  const form = await getReviewForm(tx, bookingId, viewerId);
  if (!form) return { canReview: false, submitted: false, published: false };
  return {
    canReview: form.canSubmit,
    submitted: Boolean(form.mine),
    published: form.published.length > 0,
  };
}

export async function listPublishedReviewsForSubject(
  tx: Tx,
  subjectId: string,
): Promise<PublishedReview[]> {
  const rows = (await tx.execute(sql`
    SELECT r.id, r.booking_id, r.author_id, r.subject_id, r.direction::text AS direction,
           r.rating, r.tags, r.body, r.submitted_at, r.published_at,
           p.display_name AS author_name, b.nights, l.city, b.check_out
      FROM public.reviews r
      JOIN public.bookings b ON b.id = r.booking_id
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.profiles p ON p.id = r.author_id
     WHERE r.subject_id = ${subjectId}::uuid AND r.published_at IS NOT NULL
     ORDER BY r.published_at DESC
  `)) as unknown as {
    id: string;
    booking_id: string;
    author_id: string;
    subject_id: string;
    direction: string;
    rating: number;
    tags: string[] | null;
    body: string;
    submitted_at: string;
    published_at: string;
    author_name: string;
    nights: number;
    city: string;
    check_out: string;
  }[];
  return rows.map(mapPublished);
}

export async function submitReview(
  tx: Tx,
  bookingId: string,
  rating: number,
  tags: string[],
  body: string,
): Promise<string | null> {
  const rows = (await tx.execute(
    sql`SELECT app.submit_review(${bookingId}::uuid, ${rating}, ${tags}::text[], ${body}) AS id`,
  )) as unknown as { id: string | null }[];
  return rows[0]?.id ?? null;
}

export async function publishDueReviews(tx: Tx): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT app.publish_due_reviews() AS published`,
  )) as unknown as { published: number }[];
  return Number(rows[0]?.published ?? 0);
}

export async function listReviewOpenNotices(tx: Tx): Promise<
  { bookingId: string; guestEmail: string; hostEmail: string; listingTitle: string }[]
> {
  const rows = (await tx.execute(sql`
    SELECT booking_id, guest_email, host_email, listing_title
      FROM app.review_open_notices()
  `)) as unknown as {
    booking_id: string;
    guest_email: string;
    host_email: string;
    listing_title: string;
  }[];
  return rows.map((row) => ({
    bookingId: row.booking_id,
    guestEmail: row.guest_email,
    hostEmail: row.host_email,
    listingTitle: row.listing_title,
  }));
}
