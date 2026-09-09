-- Slice 7 — trust and safety.
--
-- Stripe Identity raises verification_tier to 2 by setting id_verified.
-- Chargebacks freeze pending (and already-recorded) payouts and pause escrow
-- actions on that booking until the dispute closes. Review reminders follow
-- the checkout notice. Ops sees disputes, stale heartbeats, and frozen
-- payouts. The daily watchdog emails OPS_ALERT_EMAIL when a heartbeat is
-- stale or errored.
--
-- Clients cannot write any of this. id_verified / is_ops stay off the
-- column-level UPDATE grant. stripe_disputes and review_reminders have no
-- table grant at all — app_user reaches them only through the definer
-- functions below, the same shape as stripe_events and cron_heartbeats.

-- --------------------------------------------------------------- ops flag --

ALTER TABLE public.profiles
  ADD COLUMN is_ops boolean NOT NULL DEFAULT false,
  ADD COLUMN stripe_identity_session_id text;

CREATE OR REPLACE FUNCTION app.is_current_user_ops()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_ops FROM public.profiles p WHERE p.id = app.current_user_id()),
    false
  )
$$;

REVOKE ALL ON FUNCTION app.is_current_user_ops() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_current_user_ops() TO app_user;

-- -------------------------------------------------------- stripe_disputes --

CREATE TABLE public.stripe_disputes (
  id text PRIMARY KEY,
  payment_intent_id text,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX stripe_disputes_booking_idx ON public.stripe_disputes (booking_id);
CREATE INDEX stripe_disputes_open_idx ON public.stripe_disputes (booking_id)
  WHERE closed_at IS NULL;

ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;

-- No GRANT. Ops reads through list_ops_disputes; the webhook writes through
-- record_dispute_opened / record_dispute_closed.

-- ------------------------------------------------------ review_reminders --

CREATE TABLE public.review_reminders (
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('day3', 'day7')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, recipient_id, kind)
);

ALTER TABLE public.review_reminders ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------ open-dispute helper -----------

CREATE OR REPLACE FUNCTION app.booking_has_open_dispute(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stripe_disputes d
     WHERE d.booking_id = p_booking_id
       AND d.closed_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION app.booking_has_open_dispute(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.booking_has_open_dispute(uuid) TO app_user;

-- -------------------------------- charge.dispute.created → freeze ---------

-- Webhook-only: the caller has no app.user_id. A member hitting this would
-- freeze someone else's payout, so refuse when a session is present.
CREATE OR REPLACE FUNCTION app.record_dispute_opened(
  p_dispute_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_status text
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
  IF app.current_user_id() IS NOT NULL THEN
    RETURN false;
  END IF;

  SELECT b.id INTO v_booking_id
    FROM public.bookings b
   WHERE b.stripe_payment_intent_id = p_payment_intent_id
   LIMIT 1;

  INSERT INTO public.stripe_disputes (
    id, payment_intent_id, booking_id, amount_cents, status
  )
  VALUES (
    p_dispute_id,
    p_payment_intent_id,
    v_booking_id,
    GREATEST(COALESCE(p_amount_cents, 0), 0),
    COALESCE(NULLIF(p_status, ''), 'needs_response')
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF v_booking_id IS NOT NULL THEN
    UPDATE public.payouts
       SET state = 'frozen'
     WHERE booking_id = v_booking_id
       AND state IN ('scheduled', 'paid');
  END IF;

  RETURN inserted > 0 OR v_booking_id IS NOT NULL;
END;
$$;

-- -------------------------------- charge.dispute.closed → unfreeze --------

-- Won / warning_closed / prevented restore the payout. Lost and
-- charge_refunded stay frozen so ops still sees them.
CREATE OR REPLACE FUNCTION app.record_dispute_closed(
  p_dispute_id text,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id uuid;
  v_status text := COALESCE(NULLIF(p_status, ''), 'lost');
  updated integer;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.stripe_disputes
     SET status = v_status,
         closed_at = COALESCE(closed_at, now())
   WHERE id = p_dispute_id
  RETURNING booking_id INTO v_booking_id;
  GET DIAGNOSTICS updated = ROW_COUNT;

  IF updated = 0 THEN
    RETURN false;
  END IF;

  IF v_booking_id IS NOT NULL
     AND v_status IN ('won', 'warning_closed', 'prevented')
     AND NOT app.booking_has_open_dispute(v_booking_id) THEN
    UPDATE public.payouts
       SET state = CASE
         WHEN paid_at IS NOT NULL THEN 'paid'::public.payout_state
         ELSE 'scheduled'::public.payout_state
       END
     WHERE booking_id = v_booking_id
       AND state = 'frozen';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app.record_dispute_opened(text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_dispute_closed(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_dispute_opened(text, text, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.record_dispute_closed(text, text) TO app_user;

-- A payout recorded after the dispute opened must land frozen, not paid.
CREATE OR REPLACE FUNCTION app.record_payout(p_payment_intent_id text, p_transfer_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id uuid;
  v_host_id uuid;
  v_amount integer;
  v_frozen boolean;
  inserted integer;
BEGIN
  SELECT b.id, l.host_id, b.stay_subtotal_cents
    INTO v_booking_id, v_host_id, v_amount
    FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
   WHERE b.stripe_payment_intent_id = p_payment_intent_id
     AND b.status IN ('confirmed', 'checked_in', 'completed');

  IF v_booking_id IS NULL THEN
    RETURN false;
  END IF;

  v_frozen := app.booking_has_open_dispute(v_booking_id);

  INSERT INTO public.payouts (booking_id, host_id, amount_cents, stripe_transfer_id, state, paid_at)
  VALUES (
    v_booking_id,
    v_host_id,
    v_amount,
    p_transfer_id,
    CASE WHEN v_frozen THEN 'frozen'::public.payout_state ELSE 'paid'::public.payout_state END,
    now()
  )
  ON CONFLICT (booking_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  RETURN inserted > 0;
END;
$$;

-- ---------------------- pause escrow actions on open dispute --------------

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
       AND NOT EXISTS (
         SELECT 1 FROM public.claims c
          WHERE c.booking_id = d.booking_id
            AND c.state IN ('open', 'guest_accepted', 'guest_disputed', 'arbitration')
       )
       AND NOT app.booking_has_open_dispute(d.booking_id)
  ),
  moved AS (
    UPDATE public.escrow_deposits d
       SET state = 'released',
           released_at = now(),
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

CREATE OR REPLACE FUNCTION app.file_claim(
  p_booking_id uuid,
  p_amount_cents integer,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_host_id uuid;
  v_deposit_id uuid;
  v_deposit_amount integer;
  v_window_closes timestamptz;
  v_escrow_state public.escrow_state;
  v_claim_id uuid;
  v_moved integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  IF app.booking_has_open_dispute(p_booking_id) THEN
    RETURN NULL;
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'claim description is required';
  END IF;

  SELECT l.host_id, d.id, d.amount_cents, d.window_closes_at, d.state
    INTO v_host_id, v_deposit_id, v_deposit_amount, v_window_closes, v_escrow_state
    FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.escrow_deposits d ON d.booking_id = b.id
   WHERE b.id = p_booking_id;

  IF v_host_id IS NULL OR v_host_id IS DISTINCT FROM v_actor THEN
    RETURN NULL;
  END IF;

  IF v_escrow_state IS DISTINCT FROM 'claim_window'
     OR v_window_closes IS NULL
     OR v_window_closes <= now() THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.claims c WHERE c.booking_id = p_booking_id) THEN
    RETURN NULL;
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > v_deposit_amount THEN
    RAISE EXCEPTION 'claim amount must be between 1 and the deposit';
  END IF;

  INSERT INTO public.claims (booking_id, filed_by, amount_cents, description, state)
  VALUES (p_booking_id, v_actor, p_amount_cents, trim(p_description), 'open')
  RETURNING id INTO v_claim_id;

  UPDATE public.escrow_deposits
     SET state = 'claimed'
   WHERE id = v_deposit_id
     AND state = 'claim_window'
     AND window_closes_at > now();
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  IF v_moved = 0 THEN
    RAISE EXCEPTION 'escrow left the claim window';
  END IF;

  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  VALUES (
    v_deposit_id,
    'claim_window',
    'claimed',
    'host:file-claim',
    jsonb_build_object(
      'claim_id', v_claim_id,
      'amount_cents', p_amount_cents
    )
  );

  RETURN v_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.respond_claim(
  p_claim_id uuid,
  p_accept boolean,
  p_stripe_charge_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_booking_id uuid;
  v_guest_id uuid;
  v_deposit_id uuid;
  v_amount integer;
  v_moved integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.booking_id, b.guest_id, d.id, c.amount_cents
    INTO v_booking_id, v_guest_id, v_deposit_id, v_amount
    FROM public.claims c
    JOIN public.bookings b ON b.id = c.booking_id
    JOIN public.escrow_deposits d ON d.booking_id = b.id
   WHERE c.id = p_claim_id
     AND c.state = 'open';

  IF v_booking_id IS NULL OR v_guest_id IS DISTINCT FROM v_actor THEN
    RETURN false;
  END IF;

  IF app.booking_has_open_dispute(v_booking_id) THEN
    RETURN false;
  END IF;

  IF p_accept THEN
    UPDATE public.claims
       SET state = 'resolved_host',
           resolved_at = now(),
           resolution_amount_cents = v_amount,
           resolution_note = 'Guest accepted the claim'
     WHERE id = p_claim_id AND state = 'open';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved = 0 THEN
      RETURN false;
    END IF;

    UPDATE public.escrow_deposits
       SET state = 'released',
           released_at = now(),
           resolved_amount_cents = v_amount
     WHERE id = v_deposit_id AND state = 'claimed';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved = 0 THEN
      RAISE EXCEPTION 'escrow was not claimed';
    END IF;

    INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
    VALUES (
      v_deposit_id,
      'claimed',
      'released',
      'guest:accept-claim',
      jsonb_build_object(
        'claim_id', p_claim_id,
        'resolution_amount_cents', v_amount,
        'stripe_charge_id', p_stripe_charge_id
      )
    );
  ELSE
    UPDATE public.claims
       SET state = 'guest_disputed'
     WHERE id = p_claim_id AND state = 'open';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved = 0 THEN
      RETURN false;
    END IF;

    UPDATE public.escrow_deposits
       SET state = 'disputed'
     WHERE id = v_deposit_id AND state = 'claimed';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved = 0 THEN
      RAISE EXCEPTION 'escrow was not claimed';
    END IF;

    INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
    VALUES (
      v_deposit_id,
      'claimed',
      'disputed',
      'guest:dispute-claim',
      jsonb_build_object('claim_id', p_claim_id)
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.resolve_claim(
  p_claim_id uuid,
  p_outcome text,
  p_amount_cents integer,
  p_note text,
  p_stripe_charge_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount integer;
  v_claim_state public.claim_state;
  v_booking_id uuid;
  v_deposit_id uuid;
  v_filed integer;
  v_moved integer;
BEGIN
  IF NOT app.is_current_user_arbiter() THEN
    RETURN false;
  END IF;

  SELECT c.booking_id, c.amount_cents, d.id
    INTO v_booking_id, v_filed, v_deposit_id
    FROM public.claims c
    JOIN public.escrow_deposits d ON d.booking_id = c.booking_id
   WHERE c.id = p_claim_id
     AND c.state IN ('guest_disputed', 'arbitration')
     AND d.state = 'disputed';

  IF v_booking_id IS NULL THEN
    RETURN false;
  END IF;

  IF app.booking_has_open_dispute(v_booking_id) THEN
    RETURN false;
  END IF;

  IF p_outcome = 'host' THEN
    v_amount := v_filed;
    v_claim_state := 'resolved_host';
  ELSIF p_outcome = 'guest' THEN
    v_amount := 0;
    v_claim_state := 'resolved_guest';
  ELSIF p_outcome = 'split' THEN
    IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents >= v_filed THEN
      RAISE EXCEPTION 'split amount must be between 1 and just under the claim';
    END IF;
    v_amount := p_amount_cents;
    v_claim_state := 'resolved_split';
  ELSE
    RAISE EXCEPTION 'unknown resolution';
  END IF;

  UPDATE public.claims
     SET state = v_claim_state,
         resolved_at = now(),
         resolution_amount_cents = v_amount,
         resolution_note = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_claim_id
     AND state IN ('guest_disputed', 'arbitration');
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.escrow_deposits
     SET state = 'arbitrated',
         released_at = now(),
         resolved_amount_cents = v_amount
   WHERE id = v_deposit_id AND state = 'disputed';
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved = 0 THEN
    RAISE EXCEPTION 'escrow was not disputed';
  END IF;

  INSERT INTO public.escrow_audit (deposit_id, from_state, to_state, actor, meta)
  VALUES (
    v_deposit_id,
    'disputed',
    'arbitrated',
    'arbiter:resolve-claim',
    jsonb_build_object(
      'claim_id', p_claim_id,
      'outcome', p_outcome,
      'resolution_amount_cents', v_amount,
      'stripe_charge_id', p_stripe_charge_id
    )
  );

  RETURN true;
END;
$$;

-- ------------------------------------------- Stripe Identity → tier 2 -----

CREATE OR REPLACE FUNCTION app.set_identity_session(p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^vs_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'not a Stripe Identity session id';
  END IF;

  UPDATE public.profiles
     SET stripe_identity_session_id = p_session_id
   WHERE id = app.current_user_id()
     AND id_verified = false;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- Webhook-only. Metadata user_id is the bind; a session id is recorded when
-- present so a later redaction still points at the same member.
CREATE OR REPLACE FUNCTION app.mark_id_verified(p_user_id uuid, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN
    RETURN false;
  END IF;

  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET id_verified = true,
         stripe_identity_session_id = COALESCE(
           NULLIF(p_session_id, ''),
           stripe_identity_session_id
         )
   WHERE id = p_user_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.set_identity_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_id_verified(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_identity_session(text) TO app_user;
GRANT EXECUTE ON FUNCTION app.mark_id_verified(uuid, text) TO app_user;

-- --------------------------------------------- review reminders -----------

CREATE OR REPLACE FUNCTION app.list_review_reminders_due()
RETURNS TABLE (
  booking_id uuid,
  recipient_id uuid,
  recipient_email text,
  listing_title text,
  kind text
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
  WITH parties AS (
    SELECT b.id AS booking_id,
           b.guest_id AS recipient_id,
           gu.email AS recipient_email,
           l.title AS listing_title,
           (b.check_out + checkout_local) AT TIME ZONE l.timezone AS checkout_at,
           'guest_reviews_host'::public.review_direction AS direction
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.users gu ON gu.id = b.guest_id
     WHERE b.status = 'completed'
    UNION ALL
    SELECT b.id,
           l.host_id,
           hu.email,
           l.title,
           (b.check_out + checkout_local) AT TIME ZONE l.timezone,
           'host_reviews_guest'::public.review_direction
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.users hu ON hu.id = l.host_id
     WHERE b.status = 'completed'
  ),
  due AS (
    SELECT p.booking_id,
           p.recipient_id,
           p.recipient_email,
           p.listing_title,
           CASE
             WHEN p.checkout_at + interval '7 days' <= now() THEN 'day7'
             WHEN p.checkout_at + interval '3 days' <= now() THEN 'day3'
           END AS kind
      FROM parties p
     WHERE p.checkout_at + interval '3 days' <= now()
       AND p.checkout_at + interval '14 days' > now()
       AND NOT EXISTS (
         SELECT 1 FROM public.reviews r
          WHERE r.booking_id = p.booking_id
            AND r.author_id = p.recipient_id
       )
  )
  SELECT d.booking_id, d.recipient_id, d.recipient_email, d.listing_title, d.kind
    FROM due d
   WHERE d.kind IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.review_reminders rr
        WHERE rr.booking_id = d.booking_id
          AND rr.recipient_id = d.recipient_id
          AND rr.kind = d.kind
     );
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_review_reminder_sent(
  p_booking_id uuid,
  p_recipient_id uuid,
  p_kind text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.review_reminders (booking_id, recipient_id, kind)
  VALUES (p_booking_id, p_recipient_id, p_kind)
  ON CONFLICT (booking_id, recipient_id, kind) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.list_review_reminders_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_review_reminder_sent(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_review_reminders_due() TO app_user;
GRANT EXECUTE ON FUNCTION app.mark_review_reminder_sent(uuid, uuid, text) TO app_user;

-- -------------------------------------------------------------- ops reads --

CREATE OR REPLACE FUNCTION app.list_ops_disputes()
RETURNS TABLE (
  id text,
  payment_intent_id text,
  booking_id uuid,
  amount_cents integer,
  status text,
  created_at timestamptz,
  closed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app.is_current_user_ops() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT d.id, d.payment_intent_id, d.booking_id, d.amount_cents,
         d.status, d.created_at, d.closed_at
    FROM public.stripe_disputes d
   ORDER BY d.created_at DESC
   LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_ops_heartbeats()
RETURNS TABLE (
  job text,
  last_ok timestamptz,
  last_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app.is_current_user_ops() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT h.job, h.last_ok, h.last_error
    FROM public.cron_heartbeats h
   ORDER BY h.job;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_ops_frozen_payouts()
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  host_id uuid,
  amount_cents integer,
  state text,
  paid_at timestamptz,
  stripe_transfer_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app.is_current_user_ops() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.booking_id, p.host_id, p.amount_cents,
         p.state::text, p.paid_at, p.stripe_transfer_id
    FROM public.payouts p
   WHERE p.state = 'frozen'
   ORDER BY p.paid_at DESC NULLS LAST
   LIMIT 100;
END;
$$;

-- Watchdog: every heartbeat row. Evaluation of "stale" is in JS so the
-- cadence table lives next to the cron, not in SQL.
CREATE OR REPLACE FUNCTION app.list_watchdog_heartbeats()
RETURNS TABLE (
  job text,
  last_ok timestamptz,
  last_error text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT h.job, h.last_ok, h.last_error
    FROM public.cron_heartbeats h
   ORDER BY h.job
$$;

-- Expired bookings that settled after the TTL and still have no refund.
-- The stripe-webhook comment pointed this sweep at Slice 7.
CREATE OR REPLACE FUNCTION app.list_expired_unrefunded()
RETURNS TABLE (
  booking_id uuid,
  payment_intent_id text,
  guest_total_cents integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.stripe_payment_intent_id, b.guest_total_cents
    FROM public.bookings b
   WHERE b.status = 'expired'
     AND b.stripe_payment_intent_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.refunds r
        WHERE r.booking_id = b.id AND r.reason = 'expired'
     )
$$;

REVOKE ALL ON FUNCTION app.list_ops_disputes() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_ops_heartbeats() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_ops_frozen_payouts() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_watchdog_heartbeats() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_expired_unrefunded() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.list_ops_disputes() TO app_user;
GRANT EXECUTE ON FUNCTION app.list_ops_heartbeats() TO app_user;
GRANT EXECUTE ON FUNCTION app.list_ops_frozen_payouts() TO app_user;
GRANT EXECUTE ON FUNCTION app.list_watchdog_heartbeats() TO app_user;
GRANT EXECUTE ON FUNCTION app.list_expired_unrefunded() TO app_user;
