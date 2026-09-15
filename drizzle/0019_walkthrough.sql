-- HM-05 — the walkthrough a guest may see, and which scan is the live one.
--
-- Two facts move onto the listing when a scan verifies: `scan_verified_at`
-- and `verified_scan_id`. The pointer is what makes the walkthrough servable
-- without reading the scan queue, and it is what will let a re-mask keep the
-- live walkthrough up while a new pass verifies (HM-D05 §10) — the listing
-- keeps pointing at the old scan until a new one takes its place.
--
-- Neither column is the host's to write. `listings_host_update` let app_user
-- update any column of its own row (DECISIONS R02), so a table-level UPDATE
-- grant would hand a host the power to publish an unverified walkthrough by
-- stamping a date. Postgres cannot revoke one column out of a table-level
-- grant, so the grant is replaced with a column list: every field the editor
-- actually writes, and nothing else. `status` stays for now; D04 takes it in
-- HM-08.
--
-- The viewer reads through app.walkthrough_for_viewer, a SECURITY DEFINER
-- function, because a guest has no SELECT on listing_scans at all and must
-- not get one. It returns object keys; the server signs them and never
-- returns a bucket path.

ALTER TABLE public.listings
  ADD COLUMN scan_verified_at timestamptz,
  ADD COLUMN verified_scan_id uuid REFERENCES public.listing_scans (id) ON DELETE SET NULL,
  ADD CONSTRAINT listings_verified_needs_scan
    CHECK ((scan_verified_at IS NULL) = (verified_scan_id IS NULL));

CREATE INDEX listings_verified_idx ON public.listings (status, scan_verified_at)
  WHERE scan_verified_at IS NOT NULL;

-- ------------------------------------------------- host's own columns ------

REVOKE UPDATE ON public.listings FROM app_user;

GRANT UPDATE (
  title,
  description,
  type,
  address_line,
  city,
  region,
  country,
  lat,
  lng,
  timezone,
  nightly_rate_cents,
  deposit_cents,
  max_guests,
  amenities,
  instant_book,
  cancellation_policy,
  status,
  permit_number,
  coordinates_confirmed_at
) ON public.listings TO app_user;

-- ------------------------------------------------------- the pointer -------

-- Set wherever a scan becomes verified, so "which walk is live" is one fact
-- in one place rather than a search of the scan table.
CREATE OR REPLACE FUNCTION app.point_listing_at_verified_scan(p_scan_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.listings l
     SET scan_verified_at = now(),
         verified_scan_id = p_scan_id
    FROM public.listing_scans s
   WHERE s.id = p_scan_id
     AND l.id = s.listing_id
     AND s.state = 'verified';
$$;

REVOKE ALL ON FUNCTION app.point_listing_at_verified_scan(uuid) FROM PUBLIC;

-- --------------------------------------------- send (replaced, HM-04) ------

-- Unchanged from 0018 except the last step: a whole-home confirmation now
-- also points the listing at this scan.
CREATE OR REPLACE FUNCTION app.send_scan_for_verification(p_scan_id uuid)
RETURNS TABLE (state text, host_email text, listing_title text, listing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_listing_type public.listing_type;
  v_duration_ms numeric;
  v_whole boolean;
  v_segments jsonb;
  v_covered numeric;
  v_next public.scan_state;
BEGIN
  SELECT l.type,
         COALESCE((s.geofence_stats ->> 'durationSeconds')::numeric, 0) * 1000,
         m.whole_home_confirmed_at IS NOT NULL,
         COALESCE(m.segments, '[]'::jsonb)
    INTO v_listing_type, v_duration_ms, v_whole, v_segments
    FROM public.listing_scans s
    JOIN public.listings l ON l.id = s.listing_id
    LEFT JOIN public.listing_rental_masks m ON m.scan_id = s.id
   WHERE s.id = p_scan_id
     AND s.host_id = app.current_user_id()
     AND s.state = 'needs_mask';

  IF v_listing_type IS NULL THEN
    RETURN;
  END IF;

  IF NOT v_whole AND jsonb_array_length(v_segments) = 0 THEN
    RAISE EXCEPTION 'nothing to send: mark private parts, or confirm the whole walk is the rental';
  END IF;
  IF v_whole AND v_listing_type = 'private_room' THEN
    RAISE EXCEPTION 'a private room listing always needs its private parts marked';
  END IF;

  IF jsonb_array_length(v_segments) > 0 AND v_duration_ms > 0 THEN
    SELECT COALESCE(sum(LEAST((e ->> 'toMs')::numeric, v_duration_ms)
                        - LEAST((e ->> 'fromMs')::numeric, v_duration_ms)), 0)
      INTO v_covered
      FROM jsonb_array_elements(v_segments) AS e;
    IF v_covered >= v_duration_ms THEN
      RAISE EXCEPTION 'the whole walk is marked private; keep at least the rental area';
    END IF;
  END IF;

  v_next := CASE WHEN v_whole THEN 'verified'::public.scan_state
                 ELSE 'reconstructing'::public.scan_state END;

  UPDATE public.listing_scans s
     SET state = v_next,
         job = CASE WHEN v_whole THEN s.job ELSE 'crop'::public.scan_job_kind END,
         reason = NULL,
         verified_at = CASE WHEN v_whole THEN now() ELSE NULL END,
         claimed_at = NULL,
         worker_id = NULL,
         updated_at = now()
   WHERE s.id = p_scan_id
     AND s.host_id = app.current_user_id()
     AND s.state = 'needs_mask';

  IF v_whole THEN
    PERFORM app.point_listing_at_verified_scan(p_scan_id);
  END IF;

  RETURN QUERY
  SELECT v_next::text, u.email, l.title, l.id
    FROM public.listing_scans s
    JOIN public.listings l ON l.id = s.listing_id
    JOIN public.users u ON u.id = s.host_id
   WHERE s.id = p_scan_id;
END;
$$;

REVOKE ALL ON FUNCTION app.send_scan_for_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.send_scan_for_verification(uuid) TO app_user;

-- ------------------------------------------- finish (replaced, HM-04) ------

-- Unchanged from 0018 except that a crop job finishing `verified` now also
-- points the listing at this scan.
CREATE OR REPLACE FUNCTION app.finish_scan_job(
  p_scan_id uuid,
  p_attempt integer,
  p_outcome text,
  p_reason text,
  p_artifacts jsonb
)
RETURNS TABLE (
  host_email text,
  listing_title text,
  listing_id uuid,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_listing_id uuid;
  v_job public.scan_job_kind;
  v_prefix text;
  v_bad_key text;
  v_updated integer;
BEGIN
  IF p_outcome NOT IN ('needs_mask', 'verified', 'failed') THEN
    RAISE EXCEPTION 'unknown outcome %', p_outcome;
  END IF;
  IF p_outcome <> 'failed' AND p_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a finished reconstruction carries no reason';
  END IF;
  IF p_outcome = 'failed' AND (p_reason IS NULL OR length(p_reason) = 0) THEN
    RAISE EXCEPTION 'a failed reconstruction needs a reason';
  END IF;

  SELECT s.listing_id, s.job INTO v_listing_id, v_job
    FROM public.listing_scans s
   WHERE s.id = p_scan_id;
  IF v_listing_id IS NULL THEN
    RETURN;
  END IF;

  IF p_outcome = 'needs_mask' AND v_job <> 'reconstruct' THEN
    RAISE EXCEPTION 'a crop job cannot finish as needs_mask';
  END IF;
  IF p_outcome = 'verified' AND v_job <> 'crop' THEN
    RAISE EXCEPTION 'only a crop job can finish as verified';
  END IF;

  v_prefix := 'listings/' || v_listing_id::text || '/scans/' || p_scan_id::text || '/';

  SELECT a.object_key INTO v_bad_key
    FROM jsonb_to_recordset(COALESCE(p_artifacts, '[]'::jsonb))
      AS a(kind text, object_key text, content_type text, size_bytes bigint)
   WHERE a.object_key IS NULL
      OR left(a.object_key, length(v_prefix)) <> v_prefix
      OR a.object_key LIKE '%/../%'
      OR a.kind NOT IN ('frames', 'cameras', 'splat', 'splat_compressed', 'stills')
   LIMIT 1;
  IF v_bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'artifact key outside the scan prefix or of a kind the worker may not record: %', v_bad_key;
  END IF;

  IF p_outcome IN ('needs_mask', 'verified') AND NOT (
    EXISTS (SELECT 1 FROM jsonb_to_recordset(p_artifacts) AS a(kind text) WHERE a.kind = 'splat')
    AND EXISTS (SELECT 1 FROM jsonb_to_recordset(p_artifacts) AS a(kind text) WHERE a.kind = 'cameras')
  ) THEN
    RAISE EXCEPTION 'a finished reconstruction needs a splat and a camera list';
  END IF;

  UPDATE public.listing_scans s
     SET state = p_outcome::public.scan_state,
         reason = CASE WHEN p_outcome = 'failed' THEN p_reason ELSE NULL END,
         verified_at = CASE WHEN p_outcome = 'verified' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE s.id = p_scan_id
     AND s.state = 'reconstructing'
     AND s.attempt = p_attempt;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes)
  SELECT p_scan_id, (a.kind)::public.scan_artifact_kind, a.object_key, a.content_type, a.size_bytes
    FROM jsonb_to_recordset(COALESCE(p_artifacts, '[]'::jsonb))
      AS a(kind text, object_key text, content_type text, size_bytes bigint)
  ON CONFLICT (scan_id, object_key) DO UPDATE
     SET kind = EXCLUDED.kind,
         content_type = EXCLUDED.content_type,
         size_bytes = EXCLUDED.size_bytes;

  IF p_outcome = 'verified' THEN
    PERFORM app.point_listing_at_verified_scan(p_scan_id);
  END IF;

  RETURN QUERY
  SELECT u.email, l.title, l.id, p_outcome
    FROM public.listing_scans s
    JOIN public.listings l ON l.id = s.listing_id
    JOIN public.users u ON u.id = s.host_id
   WHERE s.id = p_scan_id;
END;
$$;

REVOKE ALL ON FUNCTION app.finish_scan_job(uuid, integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finish_scan_job(uuid, integer, text, text, jsonb) TO app_user;

-- -------------------------------------------------------- the viewer -------

-- What a guest may load, or nothing. A guest has no SELECT on listing_scans
-- and never will, so this is the only door: it opens for an `active` listing
-- whose pointer is set, or for the listing's own host previewing a draft, and
-- only when the scan it points at is actually `verified`. It returns object
-- keys, never a URL — the server signs them, so an artifact is reachable only
-- through a link that expires.
CREATE OR REPLACE FUNCTION app.walkthrough_for_viewer(p_listing_id uuid)
RETURNS TABLE (
  scan_id uuid,
  owner_preview boolean,
  captured_on date,
  verified_at timestamptz,
  policy_version integer,
  whole_home boolean,
  timezone text,
  splat_key text,
  splat_compressed_key text,
  cameras_key text,
  stills_keys text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT s.id,
         l.status <> 'active',
         s.captured_on,
         s.verified_at,
         s.honesty_policy_version,
         m.whole_home_confirmed_at IS NOT NULL,
         l.timezone,
         splat.object_key,
         compressed.object_key,
         cameras.object_key,
         COALESCE(
           (SELECT array_agg(a.object_key ORDER BY a.object_key)
              FROM public.scan_artifacts a
             WHERE a.scan_id = s.id AND a.kind = 'stills'),
           ARRAY[]::text[]
         )
    FROM public.listings l
    JOIN public.listing_scans s ON s.id = l.verified_scan_id
    LEFT JOIN public.listing_rental_masks m ON m.scan_id = s.id
    LEFT JOIN public.scan_artifacts splat
           ON splat.scan_id = s.id AND splat.kind = 'splat'
    LEFT JOIN public.scan_artifacts compressed
           ON compressed.scan_id = s.id AND compressed.kind = 'splat_compressed'
    LEFT JOIN public.scan_artifacts cameras
           ON cameras.scan_id = s.id AND cameras.kind = 'cameras'
   WHERE l.id = p_listing_id
     AND l.scan_verified_at IS NOT NULL
     AND s.state = 'verified'
     AND (l.status = 'active' OR l.host_id = app.current_user_id())
$$;

REVOKE ALL ON FUNCTION app.walkthrough_for_viewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.walkthrough_for_viewer(uuid) TO app_user;
