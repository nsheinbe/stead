-- HM-01 — front-door confirmation and the honesty scan row.
--
-- Two things a host records here, both on their own rows:
--
--   1. That the listing's lat / lng is the front door. The columns already
--      existed (0001); what was missing was the host's confirmation as a
--      recorded action. Moving the point clears the confirmation unless the
--      same statement re-confirms it, so a stale "confirmed" never survives
--      an edit.
--   2. That a walk-scan has started. listing_scans is the state machine
--      (BUILD-PLAN §7): capturing → uploaded → reconstructing → needs_mask →
--      verified / rejected / failed. app_user may INSERT a row in
--      `capturing` for a listing it owns whose door is confirmed, and SELECT
--      its own rows. Nothing else: every later state is a SECURITY DEFINER
--      transition added by the ticket that needs it (HM-02 onward), so the
--      browser can never write a verdict.
--
-- The thresholds the walk will be judged against are snapshotted onto the
-- row at creation, together with the target point and the policy version,
-- so a later config or copy change never rewrites what a host agreed to.

-- ------------------------------------------------------ front door ---------

ALTER TABLE public.listings
  ADD COLUMN coordinates_confirmed_at timestamptz,
  ADD CONSTRAINT listings_confirmed_point_needs_lat_lng
    CHECK (coordinates_confirmed_at IS NULL OR (lat IS NOT NULL AND lng IS NOT NULL));

-- Moving the point invalidates the confirmation, unless the UPDATE also sets
-- a new confirmation (the editor's "Confirm the home's location" sends lat,
-- lng and the confirmation in one statement).
CREATE OR REPLACE FUNCTION app.clear_coordinates_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)
     AND NEW.coordinates_confirmed_at IS NOT DISTINCT FROM OLD.coordinates_confirmed_at THEN
    NEW.coordinates_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_clear_coordinates_confirmation
  BEFORE UPDATE OF lat, lng ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION app.clear_coordinates_confirmation();

-- ------------------------------------------------------------ scans --------

CREATE TYPE public.scan_state AS ENUM (
  'capturing',
  'uploaded',
  'reconstructing',
  'needs_mask',
  'verified',
  'rejected',
  'failed'
);

CREATE TABLE public.listing_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  state public.scan_state NOT NULL DEFAULT 'capturing',
  -- A locked reason key (src/lib/honestyCopy.ts SCAN_REASON_COPY) once the
  -- scan is rejected or failed. Never free text from a client.
  reason text,
  honesty_policy_version integer NOT NULL CHECK (honesty_policy_version > 0),
  -- Thresholds and target, frozen at creation. Integer metres and seconds.
  accuracy_max_m integer NOT NULL CHECK (accuracy_max_m > 0),
  geofence_radius_m integer NOT NULL CHECK (geofence_radius_m > 0),
  bookend_window_seconds integer NOT NULL CHECK (bookend_window_seconds > 0),
  bookend_min_samples integer NOT NULL CHECK (bookend_min_samples > 0),
  min_indoor_seconds integer NOT NULL CHECK (min_indoor_seconds >= 0),
  max_seconds integer NOT NULL CHECK (max_seconds > 0),
  target_lat double precision NOT NULL CHECK (target_lat BETWEEN -90 AND 90),
  target_lng double precision NOT NULL CHECK (target_lng BETWEEN -180 AND 180),
  -- Listing-local calendar date of the walk; set at completion (HM-02).
  captured_on date,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reason IS NULL OR state IN ('rejected', 'failed')),
  CHECK (verified_at IS NULL OR state = 'verified')
);

CREATE INDEX listing_scans_listing_idx ON public.listing_scans (listing_id, created_at DESC);
CREATE INDEX listing_scans_host_idx ON public.listing_scans (host_id);

ALTER TABLE public.listing_scans ENABLE ROW LEVEL SECURITY;

-- Owner reads own; owner starts a capture on an owned listing whose front
-- door is confirmed. No UPDATE or DELETE grant at all.
GRANT SELECT, INSERT ON public.listing_scans TO app_user;

CREATE POLICY listing_scans_host_read ON public.listing_scans
  FOR SELECT TO app_user
  USING (host_id = app.current_user_id());

CREATE POLICY listing_scans_host_start ON public.listing_scans
  FOR INSERT TO app_user
  WITH CHECK (
    host_id = app.current_user_id()
    AND state = 'capturing'
    AND reason IS NULL
    AND captured_on IS NULL
    AND verified_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND l.host_id = app.current_user_id()
         AND l.coordinates_confirmed_at IS NOT NULL
    )
  );

-- ----------------------------------------------------------- config --------

-- DECISIONS D07 defaults. Starting points to tune with real phones; the
-- scan row snapshots whatever is current when a walk starts.
INSERT INTO public.app_config (key, value) VALUES
  ('honesty_policy_version', '1'),
  ('scan_accuracy_max_m', '35'),
  ('scan_geofence_radius_m', '100'),
  ('scan_bookend_window_seconds', '90'),
  ('scan_bookend_min_samples', '15'),
  ('scan_min_indoor_seconds', '60'),
  ('scan_max_seconds', '600')
ON CONFLICT (key) DO NOTHING;
