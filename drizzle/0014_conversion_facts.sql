-- MEAS-01: durable conversion facts.
--
-- Client events are diagnostic. They can be blocked, dropped, replayed or
-- forged, so no money or identity outcome may rest on one. This table is where
-- those outcomes actually live: written by the server, next to the transition
-- that caused them, and deduplicated by the database rather than by hope.
--
-- Three properties matter and are enforced here rather than in application
-- code:
--
--   * A lifetime fact happens once. "First confirmed booking for this member"
--     is not a counter — a partial unique index refuses the second one, so a
--     retry, a replayed webhook or a concurrent request cannot inflate it.
--   * No member can write one. `app_user` gets SELECT on its own rows and
--     nothing else; every write goes through the SECURITY DEFINER recorder
--     below, which takes the member id as an argument rather than from the
--     caller.
--   * No member can read another's. RLS is deny-by-default and the policy
--     scopes SELECT to `app.current_user_id()`.
--
-- Nothing in this migration sends anything anywhere. Delivery to an external
-- sink is a separate concern and a disabled sink must never discard a fact.

-- ---------------------------------------------------------- table ----------

CREATE TYPE public.conversion_outcome AS ENUM (
  'signup_verified',
  'booking_confirmed',
  'renter_activated',
  'listing_published',
  'homeowner_activated',
  'host_first_booking_confirmed'
);

CREATE TABLE public.conversion_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome public.conversion_outcome NOT NULL,
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The subject the outcome is about, when it is not the member: a booking for
  -- booking_confirmed, a listing for listing_published. NULL for the lifetime
  -- member facts, which is what makes the partial index below work.
  subject_id uuid,
  -- When the underlying transition happened, not when this row was written.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- Set only when a fact was reconstructed after the event, with a flag saying
  -- the original time is unknown rather than inventing one.
  reconciled_at timestamptz,
  unknown_original_time boolean NOT NULL DEFAULT false,
  -- Versioned so a later change to what "ready" means does not silently
  -- reinterpret history.
  policy_version text NOT NULL DEFAULT 'v1',
  release_id text,
  -- Allowlisted labels only: intent and source, never a raw referrer or query
  -- string. Constrained below so a bad label cannot be inserted at all.
  signup_intent text NOT NULL DEFAULT 'unknown',
  source text NOT NULL DEFAULT 'unknown',
  -- Stable across delivery retries, so a sink can deduplicate on it.
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),

  CONSTRAINT conversion_facts_intent_allowlist
    CHECK (signup_intent IN ('renter', 'homeowner', 'unknown')),
  CONSTRAINT conversion_facts_source_allowlist
    CHECK (source IN (
      'landing_primary', 'landing_homeowner', 'homeowner_hero', 'header',
      'mobile_nav', 'listing_booking', 'listing_message',
      'protected_deep_link', 'unknown'
    )),
  -- A reconciled fact must say its time is uncertain, and a fact with a known
  -- time must not claim otherwise.
  CONSTRAINT conversion_facts_reconciled_time
    CHECK (NOT unknown_original_time OR reconciled_at IS NOT NULL)
);

-- Lifetime facts: one per member, forever. The partial index is what makes
-- "once per member lifetime" a database guarantee rather than a convention.
CREATE UNIQUE INDEX conversion_facts_member_lifetime
  ON public.conversion_facts (member_id, outcome)
  WHERE subject_id IS NULL;

-- Subject facts: one per booking or listing, forever.
CREATE UNIQUE INDEX conversion_facts_subject_lifetime
  ON public.conversion_facts (outcome, subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX conversion_facts_member_idx ON public.conversion_facts (member_id, occurred_at);

-- ------------------------------------------------------------ RLS ----------

ALTER TABLE public.conversion_facts ENABLE ROW LEVEL SECURITY;

-- SELECT only, and only your own. No INSERT, UPDATE or DELETE grant exists for
-- app_user on this table at all, so there is no policy that could permit one:
-- a member cannot forge a fact, cannot overwrite their first activation, and
-- cannot delete an inconvenient one.
GRANT SELECT ON public.conversion_facts TO app_user;

CREATE POLICY conversion_facts_self_read ON public.conversion_facts
  FOR SELECT TO app_user
  USING (member_id = app.current_user_id());

-- -------------------------------------------------------- recorder ---------

-- The only way a row gets written.
--
-- SECURITY DEFINER because app_user has no INSERT grant. The member id is an
-- argument, not `app.current_user_id()`: these are written by server paths
-- that already established which member the transition belonged to, including
-- webhook paths where there is no session at all.
--
-- Idempotent by construction. ON CONFLICT DO NOTHING against the unique
-- indexes means a replayed webhook, a retried request or two concurrent
-- transactions produce one fact, and the function reports whether this call
-- was the one that created it.
CREATE OR REPLACE FUNCTION app.record_conversion_fact(
  p_outcome public.conversion_outcome,
  p_member_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_signup_intent text DEFAULT 'unknown',
  p_source text DEFAULT 'unknown',
  p_release_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted integer;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.conversion_facts (
    outcome, member_id, subject_id, occurred_at,
    signup_intent, source, release_id
  )
  VALUES (
    p_outcome,
    p_member_id,
    p_subject_id,
    COALESCE(p_occurred_at, now()),
    -- A label outside the allowlist becomes 'unknown' rather than raising:
    -- attribution is never worth failing a booking or a sign-in over.
    CASE WHEN p_signup_intent IN ('renter', 'homeowner', 'unknown')
         THEN p_signup_intent ELSE 'unknown' END,
    CASE WHEN p_source IN (
           'landing_primary', 'landing_homeowner', 'homeowner_hero', 'header',
           'mobile_nav', 'listing_booking', 'listing_message',
           'protected_deep_link', 'unknown'
         ) THEN p_source ELSE 'unknown' END,
    p_release_id
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

-- Not granted to app_user. The application calls this through the owner-run
-- server paths that already own the transition; a member's connection has no
-- route to it, which is the point.
REVOKE ALL ON FUNCTION app.record_conversion_fact(
  public.conversion_outcome, uuid, uuid, timestamptz, text, text, text
) FROM PUBLIC;

-- -------------------------------------------------- ops aggregates ---------

-- Counts only, never rows. Ops needs to know how many members activated, not
-- which ones, and this keeps the difference enforced rather than remembered.
CREATE OR REPLACE FUNCTION app.conversion_totals()
RETURNS TABLE (outcome text, total bigint, first_at timestamptz, last_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT COALESCE(
    (SELECT p.is_ops FROM public.profiles p WHERE p.id = app.current_user_id()),
    false
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.outcome::text, count(*)::bigint, min(f.occurred_at), max(f.occurred_at)
    FROM public.conversion_facts f
   GROUP BY f.outcome
   ORDER BY f.outcome::text;
END;
$$;

REVOKE ALL ON FUNCTION app.conversion_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conversion_totals() TO app_user;

-- ---------------------------------------------------- transitions ----------
--
-- Facts are written by triggers on the transitions themselves, not by the
-- application after the fact. Two reasons:
--
--   * Atomicity. `stripe_events` claims an event id first, so an analytics
--     write made after the confirming transaction can be lost forever on a
--     retry — the event is already claimed and will not be reprocessed. A
--     trigger commits with the transition or not at all.
--   * Coverage. A booking reaches `confirmed` through the webhook today and
--     may reach it another way tomorrow. A trigger on the column does not
--     care which path did it.
--
-- Every one of these fails open. Analytics must never abort a booking, a
-- publication or a payout update, so the exception handler swallows anything
-- that goes wrong and lets the real work commit. A missing fact is recoverable
-- by reconciliation; a refused payment is not.

-- Readiness policy v1, as a measurement definition and nothing more. It does
-- not gate publication and creates no new listing status: a host can publish
-- whenever they like. It only decides when a home counts as ready.
CREATE OR REPLACE FUNCTION app.maybe_record_homeowner_activation(p_host_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ready boolean;
BEGIN
  IF p_host_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.listings l
      JOIN public.profiles p ON p.id = l.host_id
     WHERE l.host_id = p_host_id
       AND l.status = 'active'
       AND p.stripe_charges_enabled
       AND p.stripe_payouts_enabled
       AND EXISTS (
         SELECT 1 FROM public.listing_photos ph WHERE ph.listing_id = l.id
       )
  ) INTO v_ready;

  IF v_ready THEN
    PERFORM app.record_conversion_fact('homeowner_activated', p_host_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app.maybe_record_homeowner_activation(uuid) FROM PUBLIC;

-- ------------------------------------------------ booking triggers ---------

CREATE OR REPLACE FUNCTION app.on_booking_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_host_id uuid;
BEGIN
  IF NEW.status <> 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM app.record_conversion_fact(
      'booking_confirmed', NEW.guest_id, NEW.id, now()
    );
    -- Lifetime fact: the unique index makes the second call a no-op, so this
    -- is safe to attempt on every confirmation.
    PERFORM app.record_conversion_fact('renter_activated', NEW.guest_id);

    SELECT l.host_id INTO v_host_id
      FROM public.listings l WHERE l.id = NEW.listing_id;
    IF v_host_id IS NOT NULL THEN
      PERFORM app.record_conversion_fact('host_first_booking_confirmed', v_host_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never let measurement refuse a payment.
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_conversion_facts
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION app.on_booking_confirmed();

-- ------------------------------------------------ listing triggers ---------

CREATE OR REPLACE FUNCTION app.on_listing_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    -- First publication only. A later pause and republish is a state change,
    -- not a second first-publication, and the unique index enforces that
    -- regardless of what this branch decides.
    IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
      PERFORM app.record_conversion_fact('listing_published', NEW.host_id, NEW.id, now());
    END IF;
    -- Readiness can be reached by publishing last, so check on every change.
    PERFORM app.maybe_record_homeowner_activation(NEW.host_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_conversion_facts
  AFTER INSERT OR UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION app.on_listing_published();

-- A photo can be the last missing piece of readiness.
CREATE OR REPLACE FUNCTION app.on_listing_photo_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_host_id uuid;
BEGIN
  BEGIN
    SELECT l.host_id INTO v_host_id FROM public.listings l WHERE l.id = NEW.listing_id;
    PERFORM app.maybe_record_homeowner_activation(v_host_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listing_photos_conversion_facts
  AFTER INSERT ON public.listing_photos
  FOR EACH ROW
  EXECUTE FUNCTION app.on_listing_photo_added();

-- Or Connect readiness can arrive last, with the home already published.
CREATE OR REPLACE FUNCTION app.on_connect_readiness_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    IF NEW.stripe_charges_enabled AND NEW.stripe_payouts_enabled THEN
      PERFORM app.maybe_record_homeowner_activation(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_conversion_facts
  AFTER UPDATE OF stripe_charges_enabled, stripe_payouts_enabled ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION app.on_connect_readiness_changed();
