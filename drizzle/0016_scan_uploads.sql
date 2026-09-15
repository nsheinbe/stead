-- HM-02 — the upload package and the first scan transition.
--
-- A walk arrives as three objects under the scan's own prefix (video,
-- location record, camera notes), presigned by the server and PUT by the
-- browser straight to the bucket. At completion the server reads the
-- location record, judges it against the row's frozen target and
-- thresholds, and calls app.complete_scan_upload, which is the only way a
-- `capturing` row becomes `uploaded` or `rejected`. app_user still has no
-- UPDATE grant on listing_scans; the function checks the caller is the host
-- and the row is still capturing, and refuses otherwise.
--
-- Two new tables, both deny-by-default:
--   scan_artifacts    — object keys the server (or later the worker) recorded.
--                       Host may SELECT own rows. No client writes.
--   scan_geo_samples  — the sequential location record with the server's
--                       per-sample judgement. No grants to app_user at all:
--                       breadcrumbs are never served to a member, and the
--                       verdict is already on the scan row.

CREATE TYPE public.scan_artifact_kind AS ENUM (
  'video',
  'attestation',
  'notes',
  'frames',
  'cameras',
  'splat',
  'splat_compressed',
  'stills',
  'approach'
);

CREATE TABLE public.scan_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.listing_scans (id) ON DELETE CASCADE,
  kind public.scan_artifact_kind NOT NULL,
  object_key text NOT NULL CHECK (length(object_key) > 0),
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, object_key)
);

CREATE INDEX scan_artifacts_scan_idx ON public.scan_artifacts (scan_id, kind);

ALTER TABLE public.scan_artifacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.scan_artifacts TO app_user;
CREATE POLICY scan_artifacts_host_read ON public.scan_artifacts
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.listing_scans s
       WHERE s.id = scan_id AND s.host_id = app.current_user_id()
    )
  );

CREATE TABLE public.scan_geo_samples (
  scan_id uuid NOT NULL REFERENCES public.listing_scans (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  t_ms integer NOT NULL CHECK (t_ms >= 0),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m integer NOT NULL CHECK (accuracy_m >= 0),
  -- The server's judgement of this reading: within the accuracy gate, and
  -- its integer distance from the frozen target.
  accurate boolean NOT NULL,
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  PRIMARY KEY (scan_id, seq)
);

ALTER TABLE public.scan_geo_samples ENABLE ROW LEVEL SECURITY;
-- No GRANT: not readable, not writable, by any member. Owner-only forever.

ALTER TABLE public.listing_scans
  ADD COLUMN geofence_stats jsonb,
  ADD COLUMN completed_at timestamptz;

-- ----------------------------------------------------- transition ----------

-- capturing → uploaded (p_ok) or rejected (NOT p_ok). The verdict, the reason,
-- the listing-local capture date and the stats are the server's arguments;
-- the browser never reaches this function with its own JSON. Returns false
-- and changes nothing unless the caller is the host and the row is still
-- capturing, so a second completion or a stranger's call is a no-op.
CREATE OR REPLACE FUNCTION app.complete_scan_upload(
  p_scan_id uuid,
  p_ok boolean,
  p_reason text,
  p_captured_on date,
  p_stats jsonb,
  p_artifacts jsonb,
  p_samples jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  IF p_ok AND p_reason IS NOT NULL THEN
    RAISE EXCEPTION 'an accepted upload carries no reason';
  END IF;
  IF NOT p_ok AND (p_reason IS NULL OR length(p_reason) = 0) THEN
    RAISE EXCEPTION 'a rejected upload needs a reason';
  END IF;

  UPDATE public.listing_scans
     SET state = CASE WHEN p_ok THEN 'uploaded'::public.scan_state ELSE 'rejected'::public.scan_state END,
         reason = CASE WHEN p_ok THEN NULL ELSE p_reason END,
         captured_on = p_captured_on,
         geofence_stats = p_stats,
         completed_at = now(),
         updated_at = now()
   WHERE id = p_scan_id
     AND host_id = app.current_user_id()
     AND state = 'capturing';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes)
  SELECT p_scan_id, (a.kind)::public.scan_artifact_kind, a.object_key, a.content_type, a.size_bytes
    FROM jsonb_to_recordset(COALESCE(p_artifacts, '[]'::jsonb))
      AS a(kind text, object_key text, content_type text, size_bytes bigint);

  INSERT INTO public.scan_geo_samples (scan_id, seq, t_ms, lat, lng, accuracy_m, accurate, distance_m)
  SELECT p_scan_id, s.seq, s.t_ms, s.lat, s.lng, s.accuracy_m, s.accurate, s.distance_m
    FROM jsonb_to_recordset(COALESCE(p_samples, '[]'::jsonb))
      AS s(seq integer, t_ms integer, lat double precision, lng double precision,
           accuracy_m integer, accurate boolean, distance_m integer);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app.complete_scan_upload(uuid, boolean, text, date, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.complete_scan_upload(uuid, boolean, text, date, jsonb, jsonb, jsonb) TO app_user;
