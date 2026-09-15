-- HM-04 — what guests may walk through, decided by the host.
--
-- A mask is host input, not a verdict, so app_user writes it directly under
-- RLS (the same shape as a listing's own fields). The policies carry the
-- rules that must hold for every writer: the row is the caller's, the scan is
-- theirs and still markable, and whole-home confirmation is refused for a
-- private room (DECISIONS D11 — a private room is partial by definition).
-- Merging, the all-private refusal and the transition stay on the server:
--
--   send_scan_for_verification   needs_mask → verified          (nothing to cut)
--                                needs_mask → reconstructing    (crop job)
--
-- Segments are integer milliseconds on the recording clock, the same clock
-- scan_geo_samples.t_ms uses. The worker drops the frames inside them before
-- it trains, so a private room never enters the splat at all (D10) — there is
-- no pixel edit anywhere in this ticket.
--
-- A crop job is a second kind of work for the same worker and the same queue,
-- so claim / finish / release are replaced below to carry the job kind:
--
--   job = 'reconstruct'   uploaded      → reconstructing → needs_mask / failed
--   job = 'crop'          reconstructing (unclaimed) → verified / failed
--
-- app_user still has no UPDATE grant on listing_scans.

CREATE TYPE public.scan_job_kind AS ENUM ('reconstruct', 'crop');

-- A CHECK cannot hold a subquery, and walking a jsonb array needs one, so the
-- shape rule lives in an IMMUTABLE function the constraint calls.
CREATE OR REPLACE FUNCTION app.mask_segments_valid(p_segments jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_typeof(p_segments) = 'array'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(p_segments) AS e
        WHERE jsonb_typeof(e) <> 'object'
           OR jsonb_typeof(e -> 'fromMs') <> 'number'
           OR jsonb_typeof(e -> 'toMs') <> 'number'
           OR (e ->> 'fromMs')::numeric < 0
           OR (e ->> 'toMs')::numeric <= (e ->> 'fromMs')::numeric
     )
$$;

ALTER TABLE public.listing_scans
  ADD COLUMN job public.scan_job_kind NOT NULL DEFAULT 'reconstruct';

-- ------------------------------------------------------------- masks -------

CREATE TABLE public.listing_rental_masks (
  scan_id uuid PRIMARY KEY REFERENCES public.listing_scans (id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  -- [{ "fromMs": int, "toMs": int }, ...] — merged, sorted, non-overlapping.
  -- The server normalises before writing; the CHECK keeps the shape honest
  -- for any other writer.
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  whole_home_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_rental_masks_segments_shape CHECK (app.mask_segments_valid(segments)),
  -- Whole home and private parts are two different answers, never both.
  CONSTRAINT listing_rental_masks_one_answer CHECK (
    whole_home_confirmed_at IS NULL OR segments = '[]'::jsonb
  )
);

CREATE INDEX listing_rental_masks_host_idx ON public.listing_rental_masks (host_id);

ALTER TABLE public.listing_rental_masks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.listing_rental_masks TO app_user;

CREATE POLICY listing_rental_masks_host_read ON public.listing_rental_masks
  FOR SELECT TO app_user
  USING (host_id = app.current_user_id());

-- A mask may be written only while the scan is waiting to be marked, only by
-- its host, and whole-home only for a listing type that can be whole (D11).
CREATE POLICY listing_rental_masks_host_insert ON public.listing_rental_masks
  FOR INSERT TO app_user
  WITH CHECK (
    host_id = app.current_user_id()
    AND EXISTS (
      SELECT 1
        FROM public.listing_scans s
        JOIN public.listings l ON l.id = s.listing_id
       WHERE s.id = scan_id
         AND s.host_id = app.current_user_id()
         AND s.state = 'needs_mask'
         AND (whole_home_confirmed_at IS NULL OR l.type <> 'private_room')
    )
  );

CREATE POLICY listing_rental_masks_host_update ON public.listing_rental_masks
  FOR UPDATE TO app_user
  USING (host_id = app.current_user_id())
  WITH CHECK (
    host_id = app.current_user_id()
    AND EXISTS (
      SELECT 1
        FROM public.listing_scans s
        JOIN public.listings l ON l.id = s.listing_id
       WHERE s.id = scan_id
         AND s.host_id = app.current_user_id()
         AND s.state = 'needs_mask'
         AND (whole_home_confirmed_at IS NULL OR l.type <> 'private_room')
    )
  );

-- --------------------------------------------------------------- send ------

-- The host's one irreversible action on this page. Host-only, and refused
-- unless the scan is waiting to be marked and the mask actually answers the
-- question. Two outcomes:
--
--   no segments (whole home confirmed)  → verified now. Nothing needs cutting,
--                                         so there is no job to run: the splat
--                                         the host just reviewed is the one
--                                         guests get.
--   segments                            → a crop job. The worker re-runs the
--                                         reconstruction with those frames
--                                         dropped and finishes as verified.
--
-- Returns the new state and who to tell, so the caller can email after the
-- transaction has committed.
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

  -- Marking everything private leaves nothing to verify. The server refuses
  -- the same thing before it gets here; this is the gate that matters.
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

-- ---------------------------------------------------- claim (replaced) -----

-- Now claims either kind of job and says which it is. A crop job is a
-- `reconstructing` row nobody holds, put there by send_scan_for_verification;
-- a reconstruct job is an `uploaded` row with a whole upload package. The
-- mask travels with the job so the worker knows which frames to drop.
DROP FUNCTION IF EXISTS app.claim_next_scan_job(text);

CREATE OR REPLACE FUNCTION app.claim_next_scan_job(p_worker_id text)
RETURNS TABLE (
  scan_id uuid,
  listing_id uuid,
  job text,
  attempt integer,
  accuracy_max_m integer,
  geofence_radius_m integer,
  target_lat double precision,
  target_lng double precision,
  timezone text,
  video_key text,
  video_content_type text,
  attestation_key text,
  notes_key text,
  mask_segments jsonb,
  duration_ms integer
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
     WHERE (
             (s.state = 'uploaded' AND s.job = 'reconstruct')
             OR (s.state = 'reconstructing' AND s.job = 'crop' AND s.claimed_at IS NULL)
           )
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
    RETURNING s.id, s.listing_id, s.job, s.attempt, s.accuracy_max_m, s.geofence_radius_m,
              s.target_lat, s.target_lng, s.geofence_stats
  )
  SELECT c.id,
         c.listing_id,
         c.job::text,
         c.attempt,
         c.accuracy_max_m,
         c.geofence_radius_m,
         c.target_lat,
         c.target_lng,
         l.timezone,
         v.object_key,
         v.content_type,
         a.object_key,
         n.object_key,
         COALESCE(m.segments, '[]'::jsonb),
         COALESCE(round((c.geofence_stats ->> 'durationSeconds')::numeric * 1000), 0)::integer
    FROM claimed c
    JOIN public.listings l ON l.id = c.listing_id
    LEFT JOIN public.scan_artifacts v ON v.scan_id = c.id AND v.kind = 'video'
    LEFT JOIN public.scan_artifacts a ON a.scan_id = c.id AND a.kind = 'attestation'
    LEFT JOIN public.scan_artifacts n ON n.scan_id = c.id AND n.kind = 'notes'
    LEFT JOIN public.listing_rental_masks m ON m.scan_id = c.id;
END;
$$;

REVOKE ALL ON FUNCTION app.claim_next_scan_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_next_scan_job(text) TO app_user;

-- --------------------------------------------------- finish (replaced) -----

-- A crop job finishes `verified`; a reconstruct job finishes `needs_mask`.
-- Neither may claim the other's outcome, so a worker running the wrong
-- pipeline cannot publish a walkthrough that was never cropped.
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

-- -------------------------------------------------- release (replaced) -----

-- A dead worker's job goes back to the queue it came from: a crop job to
-- `needs_mask` (the host's marks are still there, so sending again re-queues
-- it), a reconstruct job to `uploaded`. Only a claimed row is stale — an
-- unclaimed crop job is simply waiting.
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
       SET state = CASE
                     WHEN s.attempt >= p_max_attempts THEN 'failed'::public.scan_state
                     WHEN s.job = 'crop' THEN 'needs_mask'::public.scan_state
                     ELSE 'uploaded'::public.scan_state
                   END,
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

-- ---------------------------------------------------- retry (replaced) -----

-- A failed crop job goes back to `needs_mask`, where the host can adjust the
-- marks and send again; a failed reconstruction goes back to `uploaded`.
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
     SET state = CASE WHEN s.job = 'crop' THEN 'needs_mask'::public.scan_state
                      ELSE 'uploaded'::public.scan_state END,
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
