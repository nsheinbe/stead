-- Soft leftover — persist Connect Express payout readiness from account.updated.
--
-- The host self-serve path already creates an Express account and an Account
-- Link. Stripe then fires account.updated as charges_enabled / payouts_enabled
-- flip. Those flags are platform-controlled (same as id_verified): members
-- cannot write them. The webhook matches the connected account id and records
-- the snapshot so /host/payouts can render without a live Stripe retrieve.
--
-- Live stay charges still fail closed on a missing acct_ — readiness is the
-- host-facing signal, not a second charge path.

ALTER TABLE public.profiles
  ADD COLUMN stripe_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN stripe_details_submitted boolean NOT NULL DEFAULT false;

-- No extra UPDATE grant. Members already have only (display_name, avatar_url,
-- is_host). These three stay off that list.

CREATE OR REPLACE FUNCTION app.record_connect_readiness(
  p_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_details_submitted boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  IF p_account_id !~ '^acct_[A-Za-z0-9_]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET stripe_charges_enabled = p_charges_enabled,
         stripe_payouts_enabled = p_payouts_enabled,
         stripe_details_submitted = p_details_submitted
   WHERE stripe_connect_account_id = p_account_id;
  GET DIAGNOSTICS updated = ROW_COUNT;

  RETURN updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.record_connect_readiness(text, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_connect_readiness(text, boolean, boolean, boolean) TO app_user;
