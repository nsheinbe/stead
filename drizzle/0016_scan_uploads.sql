-- HM-02 — the walk's upload.
--
-- After a walk passes its location check (0015), the recording leaves the
-- phone: the browser puts video parts straight into the bucket on presigned
-- URLs, the server confirms each one by looking at the object, and the scan
-- becomes `uploaded` only when every declared part is confirmed. Nothing
-- multi-hundred-megabyte ever passes through the API.
--
-- What the database enforces, so the application does not have to remember:
--
--   * A package is complete or it is nothing. app.complete_scan_upload moves
--     a scan to `uploaded` only when the number of declared parts is what the
--     declaration said and every one carries a confirmed size equal to the
--     declared size. An incomplete package cannot reach reconstruction.
--   * Receipts are the server's, not the client's. app_user has SELECT on
--     scan_upload_parts (its own, to show progress after a reload) and no
--     write grant at all; a part is confirmed by app.confirm_scan_part, which
--     the API calls after a HEAD on the object, never from a client claim.
--   * Object keys are the server's. They are computed from ids the server
--     already trusts and stored here at declaration; the presign route signs
--     exactly those keys and nothing a client sent.

-- ---------------------------------------------------------------- config --

INSERT INTO public.app_config (key, value) VALUES
  ('scan_max_upload_bytes', '1500000000'),
  ('scan_max_part_bytes', '67108864'),
  ('scan_max_parts', '2000')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------- columns --

ALTER TABLE public.listing_scans
  ADD COLUMN upload_started_at timestamptz,
  ADD COLUMN uploaded_at timestamptz,
  ADD COLUMN video_mime_type text,
  ADD COLUMN video_part_count integer,
  ADD COLUMN video_bytes bigint,
  ADD COLUMN duration_ms integer,
  ADD COLUMN manifest_key text,
  -- What the phone said about itself: user agent, recorder settings. Facts,
  -- never a verdict.
  ADD COLUMN client_environment jsonb;

-- ---------------------------------------------------------------- table --

CREATE TABLE public.scan_upload_parts (
  scan_id uuid NOT NULL REFERENCES public.listing_scans (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  confirmed_bytes bigint,
  declared_at timestamptz NOT NULL DEFAULT now(),
  presigned_at timestamptz,
  confirmed_at timestamptz,
  PRIMARY KEY (scan_id, seq),
  CONSTRAINT scan_upload_parts_confirmed_pair
    CHECK ((confirmed_at IS NULL) = (confirmed_bytes IS NULL))
);

ALTER TABLE public.scan_upload_parts ENABLE ROW LEVEL SECURITY;

-- Read your own parts, so the hub can show "n of m" from the server's truth
-- after a reload. No write grant of any kind.
GRANT SELECT ON public.scan_upload_parts TO app_user;

CREATE POLICY scan_upload_parts_host_read ON public.scan_upload_parts
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.listing_scans s
       WHERE s.id = scan_id AND s.host_id = app.current_user_id()
    )
  );

-- ------------------------------------------------------------ functions --

-- Declare the package: which parts, how big, under which server-chosen keys.
--
-- Only a located walk (capturing + passed) owned by the caller. Idempotent
-- for a resumed upload: the same declaration again is accepted. A different
-- declaration replaces the old one only while nothing has been confirmed
-- yet; once a part is confirmed the shape is fixed, so a client cannot swap
-- bytes under a receipt.
CREATE OR REPLACE FUNCTION app.declare_scan_upload(
  p_scan_id uuid,
  p_mime_type text,
  p_duration_ms integer,
  p_client_environment jsonb,
  p_parts jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_count integer;
  v_declared integer;
  v_confirmed integer;
  v_same boolean;
BEGIN
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' THEN
    RAISE EXCEPTION 'parts must be a JSON array';
  END IF;
  v_count := jsonb_array_length(p_parts);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'a package needs at least one part';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listing_scans s
     WHERE s.id = p_scan_id
       AND s.host_id = v_actor
       AND s.state = 'capturing'
       AND s.geofence = 'passed'
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*), count(confirmed_at)
    INTO v_declared, v_confirmed
    FROM public.scan_upload_parts
   WHERE scan_id = p_scan_id;

  IF v_declared > 0 THEN
    -- Same shape? Then this is a resume and there is nothing to change.
    SELECT NOT EXISTS (
      SELECT 1
        FROM (
          SELECT (e ->> 'seq')::integer AS seq,
                 (e ->> 'bytes')::bigint AS bytes,
                 e ->> 'key' AS object_key
            FROM jsonb_array_elements(p_parts) AS e
        ) d
        FULL OUTER JOIN (
          SELECT seq, expected_bytes, object_key
            FROM public.scan_upload_parts
           WHERE scan_id = p_scan_id
        ) p ON p.seq = d.seq
       WHERE p.seq IS NULL
          OR d.seq IS NULL
          OR p.expected_bytes IS DISTINCT FROM d.bytes
          OR p.object_key IS DISTINCT FROM d.object_key
    ) INTO v_same;
    IF v_same THEN
      RETURN true;
    END IF;
    IF v_confirmed > 0 THEN
      RAISE EXCEPTION 'upload already in progress' USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM public.scan_upload_parts WHERE scan_id = p_scan_id;
  END IF;

  INSERT INTO public.scan_upload_parts (scan_id, seq, object_key, content_type, expected_bytes)
  SELECT p_scan_id,
         (e ->> 'seq')::integer,
         e ->> 'key',
         e ->> 'contentType',
         (e ->> 'bytes')::bigint
    FROM jsonb_array_elements(p_parts) AS e;

  UPDATE public.listing_scans
     SET upload_started_at = COALESCE(upload_started_at, now()),
         video_mime_type = p_mime_type,
         video_part_count = v_count,
         duration_ms = p_duration_ms,
         client_environment = p_client_environment,
         updated_at = now()
   WHERE id = p_scan_id;

  RETURN true;
END;
$$;

-- Bookkeeping: which parts were handed a URL, and when.
CREATE OR REPLACE FUNCTION app.mark_scan_parts_presigned(p_scan_id uuid, p_seqs integer[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_updated integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.scan_upload_parts p
     SET presigned_at = now()
    FROM public.listing_scans s
   WHERE p.scan_id = p_scan_id
     AND s.id = p.scan_id
     AND s.host_id = v_actor
     AND s.state = 'capturing'
     AND s.geofence = 'passed'
     AND p.seq = ANY (p_seqs)
     AND p.confirmed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- The receipt. The API calls this with the size it saw on the object; a size
-- other than the declared one is not a receipt. Idempotent.
CREATE OR REPLACE FUNCTION app.confirm_scan_part(p_scan_id uuid, p_seq integer, p_bytes bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_updated integer;
BEGIN
  IF v_actor IS NULL OR p_bytes IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.scan_upload_parts p
     SET confirmed_at = COALESCE(p.confirmed_at, now()),
         confirmed_bytes = COALESCE(p.confirmed_bytes, p_bytes)
    FROM public.listing_scans s
   WHERE p.scan_id = p_scan_id
     AND p.seq = p_seq
     AND s.id = p.scan_id
     AND s.host_id = v_actor
     AND s.state = 'capturing'
     AND s.geofence = 'passed'
     AND p.expected_bytes = p_bytes;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Complete or nothing. Moves a located walk to `uploaded` only when every
-- declared part is confirmed at its declared size. The pin-change trigger
-- from 0015 already revokes `uploaded` scans, so a moved pin still takes the
-- walk down.
CREATE OR REPLACE FUNCTION app.complete_scan_upload(p_scan_id uuid, p_manifest_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
  v_declared integer;
  v_parts integer;
  v_unconfirmed integer;
  v_bytes bigint;
  v_updated integer;
BEGIN
  IF v_actor IS NULL OR p_manifest_key IS NULL OR length(p_manifest_key) = 0 THEN
    RETURN false;
  END IF;

  SELECT s.video_part_count INTO v_declared
    FROM public.listing_scans s
   WHERE s.id = p_scan_id
     AND s.host_id = v_actor
     AND s.state = 'capturing'
     AND s.geofence = 'passed';
  IF v_declared IS NULL OR v_declared < 1 THEN
    RETURN false;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE confirmed_at IS NULL OR confirmed_bytes IS DISTINCT FROM expected_bytes),
         COALESCE(sum(expected_bytes), 0)
    INTO v_parts, v_unconfirmed, v_bytes
    FROM public.scan_upload_parts
   WHERE scan_id = p_scan_id;
  IF v_parts <> v_declared OR v_unconfirmed > 0 THEN
    RETURN false;
  END IF;

  UPDATE public.listing_scans
     SET state = 'uploaded',
         uploaded_at = now(),
         manifest_key = p_manifest_key,
         video_bytes = v_bytes,
         updated_at = now()
   WHERE id = p_scan_id
     AND host_id = v_actor
     AND state = 'capturing'
     AND geofence = 'passed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION app.declare_scan_upload(uuid, text, integer, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_scan_parts_presigned(uuid, integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_scan_part(uuid, integer, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_scan_upload(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.declare_scan_upload(uuid, text, integer, jsonb, jsonb) TO app_user;
GRANT EXECUTE ON FUNCTION app.mark_scan_parts_presigned(uuid, integer[]) TO app_user;
GRANT EXECUTE ON FUNCTION app.confirm_scan_part(uuid, integer, bigint) TO app_user;
GRANT EXECUTE ON FUNCTION app.complete_scan_upload(uuid, text) TO app_user;
