-- Slice 4 — reviews, double-blind publish, and the Trust Passport view.
--
-- Clients cannot write reviews.published_at (CLAUDE.md): app_user has SELECT
-- only. Submit and publish are SECURITY DEFINER, same shape as the claim
-- transitions. Drafts are author-only so the other party cannot peek — that is
-- what makes the reveal simultaneous rather than sequential. Published rows
-- are public: portable reputation is the point.

-- ---------------------------------------------------------------- types --

CREATE TYPE public.review_direction AS ENUM (
  'guest_reviews_host',
  'host_reviews_guest'
);

-- --------------------------------------------------------------- tables --

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  direction public.review_direction NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}'::text[],
  body text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT reviews_booking_direction_key UNIQUE (booking_id, direction),
  CONSTRAINT reviews_author_is_not_subject CHECK (author_id <> subject_id)
);

CREATE INDEX reviews_subject_idx ON public.reviews (subject_id);
CREATE INDEX reviews_author_idx ON public.reviews (author_id);
CREATE INDEX reviews_published_idx ON public.reviews (published_at)
  WHERE published_at IS NOT NULL;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.reviews TO app_user;

-- Public once published. Drafts are the author's — not the subject's, not a
-- stranger's. "Parties only" here means the author, who is a party; showing
-- the counterpart the unpublished body would void double-blind.
CREATE POLICY reviews_public_or_author ON public.reviews
  FOR SELECT TO app_user
  USING (
    published_at IS NOT NULL
    OR author_id = app.current_user_id()
  );

-- ---------------- both in, or 14 days after listing-local checkout ------

CREATE OR REPLACE FUNCTION app.publish_due_reviews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  checkout_local time := COALESCE(
    (SELECT (value #>> '{}')::time FROM public.app_config WHERE key = 'checkout_local_time'),
    '11:00'::time
  );
  published_count integer;
BEGIN
  WITH due AS (
    SELECT b.id AS booking_id
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
     WHERE b.status = 'completed'
       AND EXISTS (
         SELECT 1 FROM public.reviews r
          WHERE r.booking_id = b.id AND r.published_at IS NULL
       )
       AND (
         (
           EXISTS (
             SELECT 1 FROM public.reviews r
              WHERE r.booking_id = b.id AND r.direction = 'guest_reviews_host'
           )
           AND EXISTS (
             SELECT 1 FROM public.reviews r
              WHERE r.booking_id = b.id AND r.direction = 'host_reviews_guest'
           )
         )
         OR (b.check_out + checkout_local) AT TIME ZONE l.timezone + interval '14 days' <= now()
       )
  )
  UPDATE public.reviews r
     SET published_at = now()
    FROM due
   WHERE r.booking_id = due.booking_id
     AND r.published_at IS NULL;

  GET DIAGNOSTICS published_count = ROW_COUNT;
  RETURN published_count;
END;
$$;

-- ---------------------------------------------- submit (unpublished) -----

-- Guest or host of a completed stay. Direction is derived from the actor so
-- a guest cannot write host_reviews_guest. published_at stays null; publish
-- is the only writer of that column. Both sides in → reveal in this txn.
CREATE OR REPLACE FUNCTION app.submit_review(
  p_booking_id uuid,
  p_rating integer,
  p_tags text[],
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_guest_id uuid;
  v_host_id uuid;
  v_status public.booking_status;
  v_direction public.review_direction;
  v_subject uuid;
  v_review_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'rating must be between 1 and 5';
  END IF;

  SELECT b.guest_id, l.host_id, b.status
    INTO v_guest_id, v_host_id, v_status
    FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
   WHERE b.id = p_booking_id;

  IF v_guest_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'stay is not completed';
  END IF;

  IF v_actor = v_guest_id THEN
    v_direction := 'guest_reviews_host';
    v_subject := v_host_id;
  ELSIF v_actor = v_host_id THEN
    v_direction := 'host_reviews_guest';
    v_subject := v_guest_id;
  ELSE
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.reviews (
      booking_id, author_id, subject_id, direction, rating, tags, body
    )
    VALUES (
      p_booking_id,
      v_actor,
      v_subject,
      v_direction,
      p_rating,
      COALESCE(p_tags, '{}'::text[]),
      COALESCE(p_body, '')
    )
    RETURNING id INTO v_review_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'review already submitted';
  END;

  -- Both sides in → publish in this same transaction so the reveal is one stamp.
  PERFORM app.publish_due_reviews();

  RETURN v_review_id;
END;
$$;

-- Checkout just happened: both parties may write a review. S7 owns the
-- follow-up reminder cadence; this is the one notice tied to checkout.
CREATE OR REPLACE FUNCTION app.review_open_notices()
RETURNS TABLE (
  booking_id uuid,
  guest_email text,
  host_email text,
  listing_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  checkout_local time := COALESCE(
    (SELECT (value #>> '{}')::time FROM public.app_config WHERE key = 'checkout_local_time'),
    '11:00'::time
  );
BEGIN
  RETURN QUERY
  SELECT b.id,
         gu.email,
         hu.email,
         l.title
    FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.users gu ON gu.id = b.guest_id
    JOIN public.users hu ON hu.id = l.host_id
   WHERE b.status = 'completed'
     AND (b.check_out + checkout_local) AT TIME ZONE l.timezone
         BETWEEN now() - interval '70 minutes' AND now();
END;
$$;

REVOKE ALL ON FUNCTION app.submit_review(uuid, integer, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_due_reviews() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_open_notices() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.submit_review(uuid, integer, text[], text) TO app_user;
GRANT EXECUTE ON FUNCTION app.publish_due_reviews() TO app_user;
GRANT EXECUTE ON FUNCTION app.review_open_notices() TO app_user;

-- ---------------------------------------------------------- trust_stats --

-- Owner-security view (the PG default): aggregates over bookings/claims the
-- caller cannot read row-by-row. GRANT SELECT makes the passport public.
CREATE OR REPLACE VIEW public.trust_stats AS
SELECT
  p.id AS profile_id,
  (
    SELECT count(*)::integer
      FROM public.bookings b
     WHERE b.guest_id = p.id AND b.status = 'completed'
  ) AS stays_completed,
  (
    SELECT count(*)::integer
      FROM (
        SELECT ROW_NUMBER() OVER (ORDER BY b.check_out DESC, b.check_in DESC, b.id DESC) AS rn,
               EXISTS (
                 SELECT 1 FROM public.claims c
                  WHERE c.booking_id = b.id
                    AND c.state IN ('resolved_host', 'resolved_split')
               ) AS damaged
          FROM public.bookings b
         WHERE b.guest_id = p.id AND b.status = 'completed'
      ) ranked
     WHERE ranked.rn < COALESCE(
       (SELECT MIN(r2.rn) FROM (
          SELECT ROW_NUMBER() OVER (ORDER BY b.check_out DESC, b.check_in DESC, b.id DESC) AS rn,
                 EXISTS (
                   SELECT 1 FROM public.claims c
                    WHERE c.booking_id = b.id
                      AND c.state IN ('resolved_host', 'resolved_split')
                 ) AS damaged
            FROM public.bookings b
           WHERE b.guest_id = p.id AND b.status = 'completed'
        ) r2
        WHERE r2.damaged),
       2147483647
     )
  ) AS damage_free_streak,
  (
    SELECT avg(r.rating)
      FROM public.reviews r
     WHERE r.subject_id = p.id
       AND r.direction = 'host_reviews_guest'
       AND r.published_at IS NOT NULL
  ) AS avg_rating_as_guest,
  (
    SELECT avg(r.rating)
      FROM public.reviews r
     WHERE r.subject_id = p.id
       AND r.direction = 'guest_reviews_host'
       AND r.published_at IS NOT NULL
  ) AS avg_rating_as_host,
  (
    SELECT count(*)::integer
      FROM public.reviews r
     WHERE r.subject_id = p.id AND r.published_at IS NOT NULL
  ) AS review_count,
  -- Messaging is Slice 6. Leave the column so the passport shape is stable.
  NULL::numeric AS response_rate,
  (
    SELECT count(*)::integer
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
     WHERE l.host_id = p.id AND b.status = 'canceled_by_host'
  ) AS host_cancellations,
  CASE
    WHEN p.id_verified THEN 2
    WHEN p.phone_verified THEN 1
    ELSE 0
  END AS verification_tier,
  p.member_since
FROM public.profiles p;

GRANT SELECT ON public.trust_stats TO app_user;
