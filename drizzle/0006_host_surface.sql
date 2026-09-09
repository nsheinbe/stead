-- Slice 3a — the payout ledger and the Connect account attachment.
--
-- Stay charges are destination charges with on_behalf_of and
-- transfer_data.destination, and no capture_method, so Stripe captures at
-- payment and the funds reach the host's connected account then. The host is
-- merchant of record; being paid when the guest pays is the shape of that.
--
-- So a payouts row is a *record of settlement that already happened*, not an
-- instruction to move money. BUILD_PROMPT §3's "host receives at check-in"
-- predates the regulatory pivot and no longer describes the money.
--
-- amount_cents is stay_subtotal, which is what actually lands: the guest paid
-- guest_total and the platform kept application_fee_amount (the network fee).

CREATE TYPE public.payout_state AS ENUM ('scheduled', 'paid', 'frozen', 'failed');

CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One payout per booking: the unique constraint is what makes recording it
  -- from a redelivered webhook harmless.
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  stripe_transfer_id text UNIQUE,
  state public.payout_state NOT NULL DEFAULT 'scheduled',
  paid_at timestamptz
);

CREATE INDEX payouts_host_idx ON public.payouts (host_id);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- A host reads their own payouts and nobody else's. Guests do not see host
-- earnings, and there is no client write path at all: no INSERT/UPDATE/DELETE
-- grant and no policy for those verbs.
GRANT SELECT ON public.payouts TO app_user;
CREATE POLICY payouts_host_read ON public.payouts
  FOR SELECT TO app_user
  USING (host_id = app.current_user_id());

-- Called from the webhook, which is not a member, so RLS would hide the
-- booking and the listing's host from it.
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

  INSERT INTO public.payouts (booking_id, host_id, amount_cents, stripe_transfer_id, state, paid_at)
  VALUES (v_booking_id, v_host_id, v_amount, p_transfer_id, 'paid', now())
  ON CONFLICT (booking_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  RETURN inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.record_payout(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_payout(text, text) TO app_user;

-- ------------------------------------------- who may write a profile ------

-- profiles_self_update grants UPDATE on the whole row, so a member could write
-- their own stripe_connect_account_id, phone_verified and id_verified. Those
-- are platform-controlled: the first is set by Connect onboarding against an
-- account the platform created, and the other two are verification outcomes.
-- A member writing them directly would be asserting a state nobody checked.
--
-- Column-level grants are the fix. The row-level policy still applies on top,
-- so a member may edit these columns and only on their own row.
REVOKE UPDATE ON public.profiles FROM app_user;
GRANT UPDATE (display_name, avatar_url, is_host) ON public.profiles TO app_user;

-- Attaching the Connect account is therefore a definer function. It reads the
-- member from app.current_user_id() rather than taking one, so it cannot be
-- pointed at someone else's profile, and it refuses to silently repoint an
-- account that is already attached — that would redirect a host's earnings.
CREATE OR REPLACE FUNCTION app.attach_connect_account(p_account_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  IF p_account_id !~ '^acct_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'not a Stripe connected account id';
  END IF;

  UPDATE public.profiles
     SET stripe_connect_account_id = p_account_id,
         is_host = true
   WHERE id = app.current_user_id()
     AND stripe_connect_account_id IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;

  RETURN updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.attach_connect_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.attach_connect_account(text) TO app_user;
