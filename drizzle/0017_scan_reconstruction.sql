-- HM-03 — the reconstruction job and its transitions.
--
-- The worker is not a member and never holds a database credential
-- (DECISIONS D03): it calls /api/scan-worker/* with a bearer secret, and
-- those routes run as app_user with no app.user_id, so everything they touch
-- goes through the SECURITY DEFINER functions below — the same shape as the
-- cron endpoints and the Stripe webhook.
--
--   claim_next_scan_job     uploaded → reconstructing   (worker; attempt + 1)
--   finish_scan_job         reconstructing → needs_mask / failed
--                           (worker; refused unless the attempt matches, so a
--                           worker that lost its claim cannot overwrite a newer
--                           run; artifact keys must sit under the scan prefix)
--   retry_scan_reconstruction  failed → uploaded         (host; capped)
--   release_stale_scan_jobs    reconstructing → uploaded / failed
--                           (cron; a claim older than the window is treated
--                           as a dead worker)
--   scan_notice             host email + listing title for a notification
--                           (host-scoped; the finish function returns the same
--                           for the worker path)
--
-- app_user still has no UPDATE grant on listing_scans.

ALTER TABLE public.listing_scans
  ADD COLUMN attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN worker_id text;

INSERT INTO public.app_config (key, value) VALUES
  ('scan_max_attempts', '3'),
  ('scan_claim_stale_hours', '6')
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------- claim -----

CREATE OR REPLACE FUNCTION app.claim_next_scan_job(p_worker_id text)
RETURNS TABLE (
  scan_id uuid,
  listing_id uuid,
  attempt integer,
  accuracy_max_m integer,
  geofence_radius_m integer,
  target_lat double precision,
  target_lng double precision,
  timezone text,
  video_key text,
  video_content_type text,
  attestation_key text,
  notes_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'a worker must identify itself';
  END IF;
  RETURN QUERY
  WITH next AS (
    SELECT s.id
      FROM public.listing_scans s
     WHERE s.state = 'uploaded'
       -- Only a whole package is a job: the three raw kinds recorded at upload.
       AND EXISTS (SELECT 1 FROM public.scan_artifacts x WHERE x.scan_id = s.id AND x.kind = 'video')
       AND EXISTS (SELECT 1 FROM public.scan_artifacts x WHERE x.scan_id = s.id AND x.kind = 'attestation')
       AND EXISTS (SELECT 1 FROM public.scan_artifacts x WHERE x.scan_id = s.id AND x.kind = 'notes')
     ORDER BY s.completed_at NULLS LAST, s.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  ),
  claimed AS (
    UPDATE public.listing_scans s
       SET state = 'reconstructing',
           attempt = s.attempt + 1,
           claimed_at = now(),
           worker_id = p_worker_id,
           updated_at = now()
      FROM next
     WHERE s.id = next.id
    RETURNING s.id, s.listing_id, s.attempt, s.accuracy_max_m, s.geofence_radius_m,
              s.target_lat, s.target_lng
  )
  SELECT c.id,
         c.listing_id,
         c.attempt,
         c.accuracy_max_m,
         c.geofence_radius_m,
         c.target_lat,
         c.target_lng,
         l.timezone,
         v.object_key,
         v.content_type,
         a.object_key,
         n.object_key
    FROM claimed c
    JOIN public.listings l ON l.id = c.listing_id
    LEFT JOIN public.scan_artifacts v ON v.scan_id = c.id AND v.kind = 'video'
    LEFT JOIN public.scan_artifacts a ON a.scan_id = c.id AND a.kind = 'attestation'
    LEFT JOIN public.scan_artifacts n ON n.scan_id = c.id AND n.kind = 'notes';
END;
$$;

REVOKE ALL ON FUNCTION app.claim_next_scan_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_next_scan_job(text) TO app_user;

-- -------------------------------------------------------------- finish -----

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
  v_prefix text;
  v_bad_key text;
  v_updated integer;
BEGIN
  IF p_outcome NOT IN ('needs_mask', 'failed') THEN
    RAISE EXCEPTION 'unknown outcome %', p_outcome;
  END IF;
  IF p_outcome = 'needs_mask' AND p_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a finished reconstruction carries no reason';
  END IF;
  IF p_outcome = 'failed' AND (p_reason IS NULL OR length(p_reason) = 0) THEN
    RAISE EXCEPTION 'a failed reconstruction needs a reason';
  END IF;

  SELECT s.listing_id INTO v_listing_id
    FROM public.listing_scans s
   WHERE s.id = p_scan_id;
  IF v_listing_id IS NULL THEN
    RETURN;
  END IF;
  v_prefix := 'listings/' || v_listing_id::text || '/scans/' || p_scan_id::text || '/';

  -- Every recorded key sits under this scan's prefix, and only the worker's
  -- kinds may be recorded here (the raw kinds were recorded at upload).
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

  IF p_outcome = 'needs_mask' AND NOT (
    EXISTS (SELECT 1 FROM jsonb_to_recordset(p_artifacts) AS a(kind text) WHERE a.kind = 'splat')
    AND EXISTS (SELECT 1 FROM jsonb_to_recordset(p_artifacts) AS a(kind text) WHERE a.kind = 'cameras')
  ) THEN
    RAISE EXCEPTION 'a finished reconstruction needs a splat and a camera list';
  END IF;

  UPDATE public.listing_scans s
     SET state = p_outcome::public.scan_state,
         reason = CASE WHEN p_outcome = 'failed' THEN p_reason ELSE NULL END,
         updated_at = now()
   WHERE s.id = p_scan_id
     AND s.state = 'reconstructing'
     AND s.attempt = p_attempt;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN;
  END IF;

  -- Idempotent: a retried run writes the same deterministic keys.
  INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes)
  SELECT p_scan_id, (a.kind)::public.scan_artifact_kind, a.object_key, a.content_type, a.size_bytes
    FROM jsonb_to_recordset(COALESCE(p_artifacts, '[]'::jsonb))
      AS a(kind text, object_key text, content_type text, size_bytes bigint)
  ON CONFLICT (scan_id, object_key) DO UPDATE
     SET kind = EXCLUDED.kind,
         content_type = EXCLUDED.content_type,
         size_bytes = EXCLUDED.size_bytes;

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

-- --------------------------------------------------------------- retry -----

-- Host-only: failed → uploaded while attempts remain. The attempt counter is
-- not reset; the next claim increments it, so the cap holds across retries.
CREATE OR REPLACE FUNCTION app.retry_scan_reconstruction(p_scan_id uuid, p_max_attempts integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.listing_scans s
     SET state = 'uploaded',
         reason = NULL,
         worker_id = NULL,
         claimed_at = NULL,
         updated_at = now()
   WHERE s.id = p_scan_id
     AND s.host_id = app.current_user_id()
     AND s.state = 'failed'
     AND s.attempt < p_max_attempts;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.retry_scan_reconstruction(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.retry_scan_reconstruction(uuid, integer) TO app_user;

-- ------------------------------------------------------------- release -----

-- A claim older than the window is a dead worker. Return the row to the
-- queue while attempts remain; otherwise it has failed for good. Returns the
-- rows it moved so the caller can tell the host about a final failure.
CREATE OR REPLACE FUNCTION app.release_stale_scan_jobs(p_older_than interval, p_max_attempts integer)
RETURNS TABLE (scan_id uuid, state text, host_email text, listing_title text, listing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH moved AS (
    UPDATE public.listing_scans s
       SET state = CASE WHEN s.attempt < p_max_attempts
                        THEN 'uploaded'::public.scan_state
                        ELSE 'failed'::public.scan_state END,
           reason = CASE WHEN s.attempt < p_max_attempts THEN NULL ELSE 'reconstruction_failed' END,
           worker_id = NULL,
           claimed_at = NULL,
           updated_at = now()
     WHERE s.state = 'reconstructing'
       AND s.claimed_at IS NOT NULL
       AND s.claimed_at < now() - p_older_than
    RETURNING s.id, s.state, s.listing_id, s.host_id
  )
  SELECT m.id, m.state::text, u.email, l.title, l.id
    FROM moved m
    JOIN public.listings l ON l.id = m.listing_id
    JOIN public.users u ON u.id = m.host_id;
END;
$$;

REVOKE ALL ON FUNCTION app.release_stale_scan_jobs(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.release_stale_scan_jobs(interval, integer) TO app_user;

-- -------------------------------------------------------------- notice -----

-- The host's own address and title, for a notification sent in the host's
-- own request (HM-02's rejected receipt). Host-scoped.
CREATE OR REPLACE FUNCTION app.scan_notice(p_scan_id uuid)
RETURNS TABLE (host_email text, listing_title text, listing_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT u.email, l.title, l.id
    FROM public.listing_scans s
    JOIN public.listings l ON l.id = s.listing_id
    JOIN public.users u ON u.id = s.host_id
   WHERE s.id = p_scan_id
     AND s.host_id = app.current_user_id()
$$;

REVOKE ALL ON FUNCTION app.scan_notice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.scan_notice(uuid) TO app_user;
