-- HM-01 — honesty scans: the capture session and its location record.
--
-- Soft Dist launch criterion: a required geo-proven property scan before a
-- home can be bookable. This migration adds the first half of that — a scan
-- row the host starts, and a location record the server judges — and nothing
-- that makes a home bookable or a walkthrough public. Those are HM-08 and
-- HM-05, and ALLOW_GUEST_BOOKINGS is untouched.
--
-- Three rules, enforced here rather than remembered:
--
--   * The browser never writes a verdict. app_user has SELECT (own rows) and
--     DELETE (own unfinished rows) on listing_scans, and no grant at all on
--     scan_geo_samples. Starting a scan and recording its location record go
--     through the SECURITY DEFINER functions below. The verdict they store is
--     the one the API computed from the raw samples in server/lib/geofence.ts;
--     a client cannot reach either function except through that route.
--   * A verdict is bound to the pin it was judged against. The pin and the
--     thresholds are snapshotted onto the scan when it starts, and changing
--     the listing's pin afterwards revokes every scan that could still lead
--     to a walkthrough (trigger at the bottom).
--   * Location samples are provenance, not a breadcrumb trail. No member can
--     read them back, including their owner. HM-02 may move the raw record to
--     object storage; the verdict stays here.

-- ---------------------------------------------------------------- config --

-- Integer meters, seconds and minutes. Snapshotted onto each scan at start so
-- a later tuning never reinterprets a walk that was already judged.
INSERT INTO public.app_config (key, value) VALUES
  ('scan_accuracy_max_meters', '25'),
  ('scan_geofence_radius_meters', '60'),
  ('scan_indoor_tolerance_meters', '500'),
  ('scan_min_samples', '20'),
  ('scan_bookend_min_samples', '3'),
  ('scan_max_gap_seconds', '45'),
  ('scan_max_walk_minutes', '20')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------- listings --

-- A front door pin is both coordinates or neither. The route refuses one
-- without the other; this makes that true for every writer.
ALTER TABLE public.listings
  ADD CONSTRAINT listings_pin_both_or_neither CHECK ((lat IS NULL) = (lng IS NULL));

-- ---------------------------------------------------------------- types --

CREATE TYPE public.scan_state AS ENUM (
  'capturing',
  'uploaded',
  'reconstructing',
  'needs_mask',
  'verified',
  'rejected',
  'failed',
  'revoked'
);

CREATE TYPE public.scan_geofence AS ENUM ('pending', 'passed', 'failed');

CREATE TYPE public.scan_reject_reason AS ENUM ('geofence', 'samples', 'accuracy', 'bookends');

CREATE TYPE public.scan_sample_phase AS ENUM ('outdoor_start', 'indoor', 'outdoor_end');

-- --------------------------------------------------------------- tables --

CREATE TABLE public.listing_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  state public.scan_state NOT NULL DEFAULT 'capturing',
  geofence public.scan_geofence NOT NULL DEFAULT 'pending',
  reject_reason public.scan_reject_reason,
  -- The honesty policy the host acknowledged before the first frame.
  policy_version text NOT NULL,
  -- The pin this walk is judged against, frozen at start.
  pin_lat double precision NOT NULL,
  pin_lng double precision NOT NULL,
  -- Thresholds frozen at start, from app_config.
  accuracy_max_meters integer NOT NULL,
  geofence_radius_meters integer NOT NULL,
  indoor_tolerance_meters integer NOT NULL,
  min_samples integer NOT NULL,
  bookend_min_samples integer NOT NULL,
  max_gap_seconds integer NOT NULL,
  max_walk_minutes integer NOT NULL,
  -- Written by app.record_scan_location only.
  sample_count integer,
  max_distance_meters integer,
  started_at timestamptz,
  finished_at timestamptz,
  location_checked_at timestamptz,
  -- Written by the pin-change trigger (and, later, ops).
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_scans_reject_reason_only_when_failed
    CHECK (reject_reason IS NULL OR geofence = 'failed'),
  CONSTRAINT listing_scans_revoked_pair
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX listing_scans_listing_created_idx
  ON public.listing_scans (listing_id, created_at DESC);
CREATE INDEX listing_scans_host_idx ON public.listing_scans (host_id);

CREATE TABLE public.scan_geo_samples (
  scan_id uuid NOT NULL REFERENCES public.listing_scans (id) ON DELETE CASCADE,
  seq integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_meters integer NOT NULL CHECK (accuracy_meters >= 0),
  phase public.scan_sample_phase NOT NULL,
  PRIMARY KEY (scan_id, seq)
);

-- ------------------------------------------------------------------ RLS --

ALTER TABLE public.listing_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_geo_samples ENABLE ROW LEVEL SECURITY;

-- SELECT own rows, DELETE own unfinished rows. No INSERT or UPDATE grant
-- exists, so no policy could permit writing a state, a verdict or a reason.
GRANT SELECT, DELETE ON public.listing_scans TO app_user;

-- Deliberately no grant on scan_geo_samples: not readable, not writable, by
-- any member. RLS is enabled with no policy so a future grant still denies.

CREATE POLICY listing_scans_host_read ON public.listing_scans
  FOR SELECT TO app_user
  USING (host_id = app.current_user_id());

-- "Stop without finishing": an unfinished walk with no location record can be
-- thrown away by its owner. Anything the server has judged stays.
CREATE POLICY listing_scans_host_discard ON public.listing_scans
  FOR DELETE TO app_user
  USING (
    host_id = app.current_user_id()
    AND state = 'capturing'
    AND geofence = 'pending'
  );

-- ------------------------------------------------------------ functions --

-- An integer threshold from app_config, with a default so a missing key is a
-- default rather than a NULL that makes the scan row unbuildable.
CREATE OR REPLACE FUNCTION app.scan_config_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::integer FROM public.app_config WHERE key = p_key),
    p_default
  )
$$;

REVOKE ALL ON FUNCTION app.scan_config_int(text, integer) FROM PUBLIC;

-- Start a capture session.
--
-- Owner only, and the listing must already have a front door pin — there is
-- nothing to judge a walk against otherwise. Any earlier walk on this listing
-- that was never finished is discarded, so the newest row is always the
-- current one. Returns NULL for anyone but the owner, exactly like the claim
-- functions, so the route can answer 404 without learning anything.
CREATE OR REPLACE FUNCTION app.start_listing_scan(p_listing_id uuid, p_policy_version text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_host_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_scan_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_policy_version IS NULL OR length(trim(p_policy_version)) = 0 THEN
    RAISE EXCEPTION 'honesty policy version is required';
  END IF;

  SELECT l.host_id, l.lat, l.lng
    INTO v_host_id, v_lat, v_lng
    FROM public.listings l
   WHERE l.id = p_listing_id;

  IF v_host_id IS NULL OR v_host_id IS DISTINCT FROM v_actor THEN
    RETURN NULL;
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'listing has no front door pin' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.listing_scans
   WHERE listing_id = p_listing_id
     AND state = 'capturing'
     AND geofence = 'pending';

  INSERT INTO public.listing_scans (
    listing_id, host_id, policy_version, pin_lat, pin_lng,
    accuracy_max_meters, geofence_radius_meters, indoor_tolerance_meters,
    min_samples, bookend_min_samples, max_gap_seconds, max_walk_minutes
  ) VALUES (
    p_listing_id, v_actor, trim(p_policy_version), v_lat, v_lng,
    app.scan_config_int('scan_accuracy_max_meters', 25),
    app.scan_config_int('scan_geofence_radius_meters', 60),
    app.scan_config_int('scan_indoor_tolerance_meters', 500),
    app.scan_config_int('scan_min_samples', 20),
    app.scan_config_int('scan_bookend_min_samples', 3),
    app.scan_config_int('scan_max_gap_seconds', 45),
    app.scan_config_int('scan_max_walk_minutes', 20)
  )
  RETURNING id INTO v_scan_id;

  RETURN v_scan_id;
END;
$$;

-- Record the location record and the verdict the API computed from it.
--
-- The verdict arrives as arguments because the geofence rules live in
-- server/lib/geofence.ts, where they are unit-tested against fixtures; this
-- function is the only writer and refuses anything but an unfinished walk
-- owned by the caller. Samples are stored once, in the order given, and can
-- never be read back by a member. A failed walk moves to `rejected`; a passed
-- one stays `capturing` until HM-02 records its upload.
CREATE OR REPLACE FUNCTION app.record_scan_location(
  p_scan_id uuid,
  p_samples jsonb,
  p_passed boolean,
  p_reject_reason public.scan_reject_reason,
  p_sample_count integer,
  p_max_distance_meters integer,
  p_started_at timestamptz,
  p_finished_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_updated integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;
  IF p_passed AND p_reject_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a passed walk cannot carry a reject reason';
  END IF;
  IF NOT p_passed AND p_reject_reason IS NULL THEN
    RAISE EXCEPTION 'a failed walk needs a reject reason';
  END IF;
  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' THEN
    RAISE EXCEPTION 'samples must be a JSON array';
  END IF;

  UPDATE public.listing_scans
     SET geofence = CASE WHEN p_passed THEN 'passed' ELSE 'failed' END::public.scan_geofence,
         reject_reason = p_reject_reason,
         state = CASE WHEN p_passed THEN state ELSE 'rejected'::public.scan_state END,
         sample_count = p_sample_count,
         max_distance_meters = p_max_distance_meters,
         started_at = p_started_at,
         finished_at = p_finished_at,
         location_checked_at = now(),
         updated_at = now()
   WHERE id = p_scan_id
     AND host_id = v_actor
     AND state = 'capturing'
     AND geofence = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.scan_geo_samples (scan_id, seq, recorded_at, lat, lng, accuracy_meters, phase)
  SELECT p_scan_id,
         e.ord::integer,
         (e.elem ->> 'recorded_at')::timestamptz,
         (e.elem ->> 'lat')::double precision,
         (e.elem ->> 'lng')::double precision,
         (e.elem ->> 'accuracy_meters')::integer,
         (e.elem ->> 'phase')::public.scan_sample_phase
    FROM jsonb_array_elements(p_samples) WITH ORDINALITY AS e(elem, ord);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app.start_listing_scan(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_scan_location(
  uuid, jsonb, boolean, public.scan_reject_reason, integer, integer, timestamptz, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.start_listing_scan(uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.record_scan_location(
  uuid, jsonb, boolean, public.scan_reject_reason, integer, integer, timestamptz, timestamptz
) TO app_user;

-- ------------------------------------------------------ pin-change trigger --

-- A walk is proof about one pin. Move the pin and the proof no longer applies:
-- unfinished walks are dropped, anything judged or beyond is revoked with the
-- reason kept, so the host sees why and scans again. The function runs as the
-- owner because app_user has no UPDATE grant on listing_scans, which is the
-- point — the host's PATCH cannot write a scan state, but the database can.
CREATE OR REPLACE FUNCTION app.on_listing_pin_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng THEN
    DELETE FROM public.listing_scans
     WHERE listing_id = NEW.id
       AND state = 'capturing'
       AND geofence = 'pending';

    UPDATE public.listing_scans
       SET state = 'revoked',
           revoked_at = now(),
           revoked_reason = 'pin_changed',
           updated_at = now()
     WHERE listing_id = NEW.id
       AND state IN ('capturing', 'uploaded', 'reconstructing', 'needs_mask', 'verified');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_pin_changed
  AFTER UPDATE OF lat, lng ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION app.on_listing_pin_changed();
