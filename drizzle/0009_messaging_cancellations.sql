-- Slice 6 — messaging threads and the cancellation engine.
--
-- messages: thread key is (listing_id, guest_id). Guests may write before a
-- booking exists. RLS is the two participants — the listing host and the
-- guest on the thread. Clients may INSERT their own row; they cannot write
-- read_at (CLAUDE.md). Mark-read is a SECURITY DEFINER function.
--
-- cancel-booking is the enumerated transition: app_user still has no UPDATE
-- on bookings, refunds, or escrow. The function writes the refunds row, flips
-- the booking, releases the deposit, and (host cancel of a paid stay) blacks
-- the dates out. Stripe is the caller's job, outside the transaction.

-- --------------------------------------------------------------- messages --

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  sender_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT messages_not_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX messages_thread_idx ON public.messages (listing_id, created_at);
CREATE INDEX messages_recipient_unread_idx ON public.messages (recipient_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX messages_booking_idx ON public.messages (booking_id)
  WHERE booking_id IS NOT NULL;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.messages TO app_user;

-- Participants only: sender or recipient. The insert policy further requires
-- the pair to be (guest, listing host) so a stranger cannot open a thread
-- they do not belong on.
CREATE POLICY messages_participants_read ON public.messages
  FOR SELECT TO app_user
  USING (
    sender_id = app.current_user_id()
    OR recipient_id = app.current_user_id()
  );

CREATE POLICY messages_participant_insert ON public.messages
  FOR INSERT TO app_user
  WITH CHECK (
    sender_id = app.current_user_id()
    AND sender_id <> recipient_id
    AND EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND (
           (l.host_id = sender_id AND recipient_id <> l.host_id)
           OR (l.host_id = recipient_id AND sender_id <> l.host_id)
         )
    )
    AND (
      booking_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.bookings b
         WHERE b.id = booking_id
           AND b.listing_id = listing_id
           AND (b.guest_id = sender_id OR b.guest_id = recipient_id)
      )
    )
  );

-- Mark every unread inbound row on this thread. The viewer must be the guest
-- or the listing host — otherwise zero rows match and we raise.
CREATE OR REPLACE FUNCTION app.mark_thread_read(p_listing_id uuid, p_guest_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_host uuid;
  v_me uuid := app.current_user_id();
  updated integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  SELECT host_id INTO v_host
    FROM public.listings
   WHERE id = p_listing_id;

  IF v_host IS NULL THEN
    RAISE EXCEPTION 'listing not found';
  END IF;

  IF v_me <> p_guest_id AND v_me <> v_host THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  UPDATE public.messages
     SET read_at = now()
   WHERE listing_id = p_listing_id
     AND recipient_id = v_me
     AND read_at IS NULL
     AND (sender_id = p_guest_id OR recipient_id = p_guest_id);

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION app.mark_thread_read(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_thread_read(uuid, uuid) TO app_user;

-- app_user has no grant on public.users. After a send, the route needs the
-- recipient's address for the notify email. This returns it only for a
-- message the caller just wrote — not a general email lookup.
CREATE OR REPLACE FUNCTION app.recipient_for_sent_message(p_message_id uuid)
RETURNS TABLE (
  email text,
  recipient_name text,
  sender_name text,
  listing_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.email,
         COALESCE(NULLIF(rp.display_name, ''), split_part(u.email, '@', 1)),
         COALESCE(NULLIF(sp.display_name, ''), split_part(su.email, '@', 1)),
         l.title
    FROM public.messages m
    JOIN public.listings l ON l.id = m.listing_id
    JOIN public.users u ON u.id = m.recipient_id
    JOIN public.users su ON su.id = m.sender_id
    JOIN public.profiles rp ON rp.id = m.recipient_id
    JOIN public.profiles sp ON sp.id = m.sender_id
   WHERE m.id = p_message_id
     AND m.sender_id = app.current_user_id()
$$;

REVOKE ALL ON FUNCTION app.recipient_for_sent_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.recipient_for_sent_message(uuid) TO app_user;

-- ------------------------------------------ cancel-booking ---------------

CREATE OR REPLACE FUNCTION app.cancel_booking(
  p_booking_id uuid,
  p_refund_cents integer,
  p_stripe_refund_id text,
  p_as_host boolean
)
RETURNS TABLE (
  booking_id uuid,
  new_status public.booking_status,
  refund_id uuid,
  guest_email text,
  host_email text,
  listing_title text,
  guest_name text,
  host_name text,
  deposit_released boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := app.current_user_id();
  v_guest uuid;
  v_host uuid;
  v_listing uuid;
  v_status public.booking_status;
  v_total integer;
  v_check_in date;
  v_check_out date;
  v_new public.booking_status;
  v_refund uuid;
  v_released integer := 0;
  v_guest_email text;
  v_host_email text;
  v_title text;
  v_guest_name text;
  v_host_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  IF p_refund_cents IS NULL OR p_refund_cents < 0 THEN
    RAISE EXCEPTION 'refund must be a non-negative integer number of cents';
  END IF;

  SELECT b.guest_id, l.host_id, b.listing_id, b.status, b.guest_total_cents,
         b.check_in, b.check_out, l.title,
         COALESCE(NULLIF(gp.display_name, ''), split_part(gu.email, '@', 1)),
         COALESCE(NULLIF(hp.display_name, ''), split_part(hu.email, '@', 1)),
         gu.email, hu.email
    INTO v_guest, v_host, v_listing, v_status, v_total,
         v_check_in, v_check_out, v_title,
         v_guest_name, v_host_name, v_guest_email, v_host_email
    FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.profiles gp ON gp.id = b.guest_id
    JOIN public.users gu ON gu.id = b.guest_id
    JOIN public.profiles hp ON hp.id = l.host_id
    JOIN public.users hu ON hu.id = l.host_id
   WHERE b.id = p_booking_id;

  IF v_guest IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF p_as_host THEN
    IF v_me <> v_host THEN
      RAISE EXCEPTION 'only the host can cancel as host';
    END IF;
    v_new := 'canceled_by_host';
  ELSE
    IF v_me <> v_guest THEN
      RAISE EXCEPTION 'only the guest can cancel as guest';
    END IF;
    v_new := 'canceled_by_guest';
  END IF;

  IF v_status NOT IN ('pending_payment', 'confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'this stay cannot be canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.escrow_deposits d
     WHERE d.booking_id = p_booking_id
       AND d.state IN ('claimed', 'disputed', 'arbitrated')
  ) THEN
    RAISE EXCEPTION 'a claim is open on this stay';
  END IF;

  IF p_refund_cents > v_total THEN
    RAISE EXCEPTION 'refund cannot exceed guest_total';
  END IF;

  IF v_status = 'pending_payment' AND p_refund_cents <> 0 THEN
    RAISE EXCEPTION 'pending_payment has no charge to refund';
  END IF;

  IF p_as_host AND v_status <> 'pending_payment' AND p_refund_cents <> v_total THEN
    RAISE EXCEPTION 'host cancel refunds the stay and the fee in full';
  END IF;

  UPDATE public.bookings
     SET status = v_new
   WHERE id = p_booking_id
     AND status = v_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this stay cannot be canceled';
  END IF;

  IF p_refund_cents > 0 THEN
    INSERT INTO public.refunds (booking_id, amount_cents, reason, stripe_refund_id)
    VALUES (
      p_booking_id,
      p_refund_cents,
      CASE WHEN p_as_host THEN 'host_cancel'::public.refund_reason
           ELSE 'guest_cancel'::public.refund_reason END,
      p_stripe_refund_id
    )
    RETURNING id INTO v_refund;
  END IF;

  -- Deposit: always fully released on any cancellation. card_on_file never
  -- captured it; scheduled / held / claim_window all close here. UPDATE
  -- RETURNING would see the new state, so the old one is captured first.
  WITH due AS (
    SELECT d.id, d.state AS from_state
      FROM public.escrow_deposits d
     WHERE d.booking_id = p_booking_id
       AND d.state IN ('scheduled', 'held', 'claim_window')
  ),
  moved AS (
    UPDATE public.escrow_deposits d
       SET state = 'released',
           released_at = now(),
           resolved_amount_cents = 0
      FROM due
     WHERE d.id = due.id
    RETURNING d.id, due.from_state
  )
  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  SELECT id,
         from_state,
         'released',
         CASE WHEN p_as_host THEN 'cancel-booking:host' ELSE 'cancel-booking:guest' END,
         jsonb_build_object('refund_cents', p_refund_cents, 'reason', v_new)
    FROM moved;

  GET DIAGNOSTICS v_released = ROW_COUNT;

  -- Host cancel of a paid stay blacks the dates so they cannot be rebooked.
  -- pending_payment just drops the exclusion hold — the calendar opens again.
  IF p_as_host AND v_status IN ('confirmed', 'checked_in') THEN
    INSERT INTO public.listing_blackouts (listing_id, start_date, end_date)
    VALUES (v_listing, v_check_in, v_check_out);
  END IF;

  -- Payouts are a record of a destination charge that already settled when
  -- the guest paid (0006). Pre-check-in the caller refunds with
  -- reverse_transfer so Stripe pulls the Connect transfer back. Post-check-in
  -- the refund is funded from the platform balance —
  -- TODO: flag negative-balance risk if the host has already paid out to their
  -- bank and the connected account cannot cover the reversal.

  booking_id := p_booking_id;
  new_status := v_new;
  refund_id := v_refund;
  guest_email := v_guest_email;
  host_email := v_host_email;
  listing_title := v_title;
  guest_name := v_guest_name;
  host_name := v_host_name;
  deposit_released := v_released > 0;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION app.cancel_booking(uuid, integer, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cancel_booking(uuid, integer, text, boolean) TO app_user;

-- --------------------------- trust_stats.response_rate -------------------

-- Fraction of guest-started threads on this member's listings that received
-- a host reply. NULL when nobody has written yet, so the passport stays blank
-- rather than showing 0% for a host with no inbox.
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
  (
    SELECT
      CASE
        WHEN count(*) FILTER (WHERE first_guest_at IS NOT NULL) = 0 THEN NULL
        ELSE (
          count(*) FILTER (
            WHERE first_guest_at IS NOT NULL
              AND first_host_at IS NOT NULL
              AND first_host_at >= first_guest_at
          )::numeric
          / count(*) FILTER (WHERE first_guest_at IS NOT NULL)
        )
      END
      FROM (
        SELECT
          MIN(m.created_at) FILTER (WHERE m.sender_id <> l.host_id) AS first_guest_at,
          MIN(m.created_at) FILTER (WHERE m.sender_id = l.host_id) AS first_host_at
          FROM public.messages m
          JOIN public.listings l ON l.id = m.listing_id
         WHERE l.host_id = p.id
         GROUP BY m.listing_id,
                  CASE WHEN m.sender_id = l.host_id THEN m.recipient_id ELSE m.sender_id END
      ) threads
  ) AS response_rate,
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
