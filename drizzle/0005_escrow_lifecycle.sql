-- Slice 2 — escrow lifecycle.
--
-- Three scheduled transitions plus the refund path for a payment that settles
-- after its booking has already expired. Every transition writes an
-- escrow_audit row, and every one is set-based with the legal from_state in
-- its WHERE clause: an illegal edge matches no rows and changes nothing.
--
-- Deposits are card_on_file only. A 30-night minimum stay against
-- deposit_auth_max_nights = 4 makes auth_hold unreachable, and a card auth
-- lasts about seven days so it could not cover the stay in any case.
-- hold_due_escrows refuses loudly rather than silently treating an auth_hold
-- deposit as held.
--
-- All scheduling is listing-local: check-in at 16:00 is a different instant in
-- Kyoto than in Bend, and on a DST boundary it is not a fixed offset from UTC.
-- The zone conversion happens here in SQL, never in JS.

-- --------------------------------------------------------------- refunds --

CREATE TYPE public.refund_reason AS ENUM (
  'guest_cancel',
  'host_cancel',
  'dispute',
  -- Payment settled after the pending_payment TTL had already expired the
  -- booking. The guest holds nothing, so the whole guest_total goes back,
  -- network fee included.
  'expired'
);

CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  reason public.refund_reason NOT NULL,
  stripe_refund_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refunds_booking_idx ON public.refunds (booking_id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- Booking parties read their own refunds. Nobody writes one from a client:
-- there is no INSERT/UPDATE/DELETE grant and no policy for those verbs, so
-- the only writer is the SECURITY DEFINER function below.
GRANT SELECT ON public.refunds TO app_user;
CREATE POLICY refunds_party_read ON public.refunds
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_id
         AND (
           b.guest_id = app.current_user_id()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = app.current_user_id()
           )
         )
    )
  );

-- ------------------------------------------------- scheduled → held --------

CREATE OR REPLACE FUNCTION app.hold_due_escrows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  checkin_local time := COALESCE(
    (SELECT (value #>> '{}')::time FROM public.app_config WHERE key = 'checkin_local_time'),
    '16:00'::time
  );
  moved_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.escrow_deposits d
      JOIN public.bookings b ON b.id = d.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE d.state = 'scheduled'
       AND d.method = 'auth_hold'
       AND (b.check_in + checkin_local) AT TIME ZONE l.timezone <= now()
  ) THEN
    RAISE EXCEPTION 'auth_hold deposit is due but unsupported; deposits are card_on_file only';
  END IF;

  WITH due AS (
    SELECT d.id AS deposit_id, b.id AS booking_id
      FROM public.escrow_deposits d
      JOIN public.bookings b ON b.id = d.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE d.state = 'scheduled'
       AND d.method = 'card_on_file'
       AND b.status = 'confirmed'
       AND (b.check_in + checkin_local) AT TIME ZONE l.timezone <= now()
  ),
  booking_moved AS (
    UPDATE public.bookings b
       SET status = 'checked_in'
      FROM due
     WHERE b.id = due.booking_id AND b.status = 'confirmed'
  ),
  moved AS (
    UPDATE public.escrow_deposits d
       SET state = 'held', held_at = now()
      FROM due
     WHERE d.id = due.deposit_id
    RETURNING d.id
  )
  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  SELECT id, 'scheduled', 'held', 'cron:check-in',
         jsonb_build_object('method', 'card_on_file')
    FROM moved;

  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END;
$$;

-- --------------------------------------------- held → claim_window ---------

CREATE OR REPLACE FUNCTION app.open_due_claim_windows()
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
  window_hours integer := COALESCE(
    (SELECT (value #>> '{}')::integer FROM public.app_config WHERE key = 'claim_window_hours'),
    48
  );
  moved_count integer;
BEGIN
  WITH due AS (
    SELECT d.id AS deposit_id,
           b.id AS booking_id,
           (b.check_out + checkout_local) AT TIME ZONE l.timezone AS checkout_at
      FROM public.escrow_deposits d
      JOIN public.bookings b ON b.id = d.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE d.state = 'held'
       AND (b.check_out + checkout_local) AT TIME ZONE l.timezone <= now()
  ),
  booking_moved AS (
    UPDATE public.bookings b
       SET status = 'completed'
      FROM due
     WHERE b.id = due.booking_id AND b.status = 'checked_in'
  ),
  moved AS (
    UPDATE public.escrow_deposits d
       SET state = 'claim_window',
           window_closes_at = due.checkout_at + make_interval(hours => window_hours)
      FROM due
     WHERE d.id = due.deposit_id
    RETURNING d.id, d.window_closes_at
  )
  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  SELECT id, 'held', 'claim_window', 'cron:check-out',
         jsonb_build_object('window_closes_at', window_closes_at)
    FROM moved;

  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END;
$$;

-- ------------------------------------------ claim_window → released --------

-- Returns what it released, including who to tell. The caller is a scheduler
-- with no app.user_id, so RLS would hide the guest's email from it — this
-- function is SECURITY DEFINER precisely so the notification payload comes
-- back with the transition rather than needing a second, unscoped read.
--
-- There is no open-claim guard yet because public.claims does not exist until
-- Slice 3 — add `AND NOT EXISTS (SELECT 1 FROM public.claims ...)` in the same
-- migration that creates it.
CREATE OR REPLACE FUNCTION app.release_due_escrows()
RETURNS TABLE (
  deposit_id uuid,
  booking_id uuid,
  guest_email text,
  listing_title text,
  amount_cents integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id
      FROM public.escrow_deposits d
     WHERE d.state = 'claim_window'
       AND d.window_closes_at IS NOT NULL
       AND d.window_closes_at <= now()
  ),
  moved AS (
    UPDATE public.escrow_deposits d
       SET state = 'released',
           released_at = now(),
           -- Nothing was ever captured on a card_on_file deposit, so the
           -- amount resolved to the host is zero.
           resolved_amount_cents = 0
      FROM due
     WHERE d.id = due.id
    RETURNING d.id, d.booking_id
  ),
  audited AS (
    INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
    SELECT id, 'claim_window', 'released', 'cron:release-deposits',
           jsonb_build_object('reason', 'claim window closed with no claim')
      FROM moved
    RETURNING public.escrow_audit.deposit_id
  )
  SELECT m.id,
         m.booking_id,
         u.email,
         l.title,
         d.amount_cents
    FROM moved m
    JOIN public.escrow_deposits d ON d.id = m.id
    JOIN public.bookings b ON b.id = m.booking_id
    JOIN public.users u ON u.id = b.guest_id
    JOIN public.listings l ON l.id = b.listing_id;
END;
$$;

-- ---------------------------------- payment settled after expiry -----------

-- B-2. The guest paid, the TTL had already expired the booking, and they hold
-- nothing. Refund the whole guest_total and close the escrow that was never
-- held. False means this is not that case, or the refund was already recorded.
CREATE OR REPLACE FUNCTION app.refund_expired_booking(
  p_payment_intent_id text,
  p_refund_id text,
  p_amount_cents integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id uuid;
  inserted integer;
BEGIN
  SELECT id INTO v_booking_id
    FROM public.bookings
   WHERE stripe_payment_intent_id = p_payment_intent_id
     AND status = 'expired';

  IF v_booking_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.refunds (booking_id, amount_cents, reason, stripe_refund_id)
  VALUES (v_booking_id, p_amount_cents, 'expired', p_refund_id)
  ON CONFLICT (stripe_refund_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted = 0 THEN
    RETURN false;
  END IF;

  WITH moved AS (
    UPDATE public.escrow_deposits
       SET state = 'released', released_at = now(), resolved_amount_cents = 0
     WHERE booking_id = v_booking_id
       AND state = 'scheduled'
    RETURNING id
  )
  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  SELECT id, 'scheduled', 'released', 'webhook:payment_after_expiry',
         jsonb_build_object('refund_id', p_refund_id, 'amount_cents', p_amount_cents)
    FROM moved;

  RETURN true;
END;
$$;

-- The webhook has no app.user_id, so RLS hides bookings from it. This is the
-- read that decides whether a settled payment landed on an already-expired
-- booking, and it must happen before any refund is issued.
CREATE OR REPLACE FUNCTION app.expired_booking_for_payment_intent(p_payment_intent_id text)
RETURNS TABLE (booking_id uuid, guest_total_cents integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.guest_total_cents
    FROM public.bookings b
   WHERE b.stripe_payment_intent_id = p_payment_intent_id
     AND b.status = 'expired'
     -- Nothing to do if a refund for this booking is already on record.
     AND NOT EXISTS (
       SELECT 1 FROM public.refunds r
        WHERE r.booking_id = b.id AND r.reason = 'expired'
     );
$$;

REVOKE ALL ON FUNCTION app.hold_due_escrows() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.open_due_claim_windows() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.release_due_escrows() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.refund_expired_booking(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expired_booking_for_payment_intent(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.hold_due_escrows() TO app_user;
GRANT EXECUTE ON FUNCTION app.open_due_claim_windows() TO app_user;
GRANT EXECUTE ON FUNCTION app.release_due_escrows() TO app_user;
GRANT EXECUTE ON FUNCTION app.refund_expired_booking(text, text, integer) TO app_user;
GRANT EXECUTE ON FUNCTION app.expired_booking_for_payment_intent(text) TO app_user;
