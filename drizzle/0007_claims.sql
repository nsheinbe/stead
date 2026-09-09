-- Slice 3b — claims, evidence, and arbiter resolution.
--
-- One claim per stay. Hosts file during the claim window (amount ≤ deposit);
-- the guest accepts or disputes; an arbiter resolves a dispute. Clients cannot
-- write claims: app_user has SELECT only. Every state change is a SECURITY
-- DEFINER function with the legal from_state in its WHERE clause, same shape
-- as the escrow transitions in 0005.
--
-- 0005 left the open-claim guard as a comment on release_due_escrows because
-- this table did not exist yet. The replacement below adds the NOT EXISTS.

-- --------------------------------------------------------------- arbiter --

-- Platform-controlled, like phone_verified and id_verified. The column-level
-- UPDATE grant from 0006 does not include it, so a member cannot mark
-- themselves an arbiter. Seed and the owner set it; the policies below read it.
ALTER TABLE public.profiles
  ADD COLUMN is_arbiter boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.is_current_user_arbiter()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_arbiter FROM public.profiles p WHERE p.id = app.current_user_id()),
    false
  )
$$;

REVOKE ALL ON FUNCTION app.is_current_user_arbiter() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_current_user_arbiter() TO app_user;

-- BUILD_PROMPT §4: escrow is visible to booking parties + the arbiter. The
-- original policies in 0002 named only the parties; claims need the arbiter
-- to read the card-on-file handle before charging a resolution.
DROP POLICY escrow_party_read ON public.escrow_deposits;
CREATE POLICY escrow_party_read ON public.escrow_deposits
  FOR SELECT TO app_user
  USING (
    app.is_current_user_arbiter()
    OR EXISTS (
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

DROP POLICY escrow_audit_party_read ON public.escrow_audit;
CREATE POLICY escrow_audit_party_read ON public.escrow_audit
  FOR SELECT TO app_user
  USING (
    app.is_current_user_arbiter()
    OR EXISTS (
      SELECT 1
        FROM public.escrow_deposits d
        JOIN public.bookings b ON b.id = d.booking_id
       WHERE d.id = deposit_id
         AND (
           b.guest_id = app.current_user_id()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = app.current_user_id()
           )
         )
    )
  );

-- ---------------------------------------------------------------- types --

CREATE TYPE public.claim_state AS ENUM (
  'open',
  'guest_accepted',
  'guest_disputed',
  'arbitration',
  'resolved_host',
  'resolved_guest',
  'resolved_split'
);

-- --------------------------------------------------------------- tables --

CREATE TABLE public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  filed_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  state public.claim_state NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_amount_cents integer CHECK (
    resolution_amount_cents IS NULL OR resolution_amount_cents >= 0
  ),
  resolution_note text
);

CREATE INDEX claims_filed_by_idx ON public.claims (filed_by);
CREATE INDEX claims_state_idx ON public.claims (state);

CREATE TABLE public.claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims (id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  note text
);

CREATE INDEX claim_evidence_claim_idx ON public.claim_evidence (claim_id);

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_evidence ENABLE ROW LEVEL SECURITY;

-- Booking parties and the arbiter may read. Nobody writes a claim from a
-- client: no INSERT/UPDATE/DELETE grant, so the only writers are the
-- functions below.
GRANT SELECT ON public.claims TO app_user;
CREATE POLICY claims_party_or_arbiter_read ON public.claims
  FOR SELECT TO app_user
  USING (
    app.is_current_user_arbiter()
    OR EXISTS (
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

-- Evidence is supporting material, not a money state. Parties may attach a
-- row for themselves on a live claim; the arbiter and the parties may read.
-- No UPDATE/DELETE — a photo that was part of a dispute does not vanish.
GRANT SELECT, INSERT ON public.claim_evidence TO app_user;
CREATE POLICY claim_evidence_party_or_arbiter_read ON public.claim_evidence
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.claims c
       WHERE c.id = claim_id
         AND (
           app.is_current_user_arbiter()
           OR EXISTS (
             SELECT 1 FROM public.bookings b
              WHERE b.id = c.booking_id
                AND (
                  b.guest_id = app.current_user_id()
                  OR EXISTS (
                    SELECT 1 FROM public.listings l
                     WHERE l.id = b.listing_id AND l.host_id = app.current_user_id()
                  )
                )
           )
         )
    )
  );
CREATE POLICY claim_evidence_party_insert ON public.claim_evidence
  FOR INSERT TO app_user
  WITH CHECK (
    uploaded_by = app.current_user_id()
    AND EXISTS (
      SELECT 1
        FROM public.claims c
        JOIN public.bookings b ON b.id = c.booking_id
        JOIN public.listings l ON l.id = b.listing_id
       WHERE c.id = claim_id
         AND c.state IN ('open', 'guest_accepted', 'guest_disputed', 'arbitration')
         AND (b.guest_id = app.current_user_id() OR l.host_id = app.current_user_id())
    )
  );

-- ---------------------------------------- claim_window → claimed (file) --

-- Host only, during an open claim window, amount between 1 and the deposit.
-- Wrong party or wrong escrow state returns NULL rather than raising, so a
-- replay or a late file is a no-op the API can surface as 409. A bad amount
-- raises, because that is the caller's mistake and must not look like a race.
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
    -- Race with release: roll the claim insert back with the function.
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

-- ----------------------------------- claimed → released | disputed --------

-- Guest only. Accepting the host's figure in full is resolved_host and
-- releases the remainder of the deposit. Disputing parks the escrow for an
-- arbiter. p_stripe_charge_id is the off-session PaymentIntent on the host's
-- connected account; the caller charges first (or skips when amount is zero
-- / Stripe is unset) and this records it on the audit row.
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

-- -------------------------------- disputed → arbitrated (resolve) --------

-- Arbiter only. host = the filed amount, guest = nothing, split = a figure
-- strictly between the two. Wrong party or wrong state is false; a bad
-- outcome/amount raises.
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

-- The API needs the two parties' emails after a transition, and app_user
-- cannot read public.users. Same reason release_due_escrows returns guest_email.
CREATE OR REPLACE FUNCTION app.claim_notice(p_claim_id uuid)
RETURNS TABLE (
  guest_email text,
  host_email text,
  listing_title text,
  amount_cents integer,
  resolution_amount_cents integer,
  state text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gu.email,
         hu.email,
         l.title,
         c.amount_cents,
         c.resolution_amount_cents,
         c.state::text
    FROM public.claims c
    JOIN public.bookings b ON b.id = c.booking_id
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.users gu ON gu.id = b.guest_id
    JOIN public.users hu ON hu.id = l.host_id
   WHERE c.id = p_claim_id
     AND (
       app.is_current_user_arbiter()
       OR b.guest_id = app.current_user_id()
       OR l.host_id = app.current_user_id()
     );
$$;

REVOKE ALL ON FUNCTION app.file_claim(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.respond_claim(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_claim(uuid, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_notice(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.file_claim(uuid, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.respond_claim(uuid, boolean, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.resolve_claim(uuid, text, integer, text, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.claim_notice(uuid) TO app_user;

-- ------------------------- claim_window → released (open-claim guard) ----

-- Same function as 0005, plus the NOT EXISTS 0005 marked. An open (or
-- in-flight) claim keeps the deposit in the window; resolved claims do not,
-- because those already moved the escrow off claim_window.
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
