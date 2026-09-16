-- HM-06 — the street: who may see the door, and at what precision.
--
-- The editor promises the street address is "shared with a guest after a stay
-- is confirmed, not on the public page". A pin on the front door is the
-- address by another name, and a walk up to it is the address in pictures, so
-- both follow the same promise (DECISIONS D09): private by default, the host
-- may open them to everyone, and a guest with a confirmed stay always sees
-- them.
--
-- Two things therefore have to be decided by the server, never the browser:
--
--  1. **Precision.** A viewer who is not entitled gets a pin rounded to a
--     grid before it leaves the database. Rounding to a fixed grid, rather
--     than adding jitter, is the point: jitter averages out over repeated
--     reads and hands back the true point, while every read of a grid cell
--     returns the same cell.
--  2. **Existence.** Whether the host filmed an approach at all is public
--     (the page says so in words), but the artifact keys are not: a guest
--     has no SELECT on scan_artifacts and must not get one, so the read goes
--     through a SECURITY DEFINER function exactly as the walkthrough does.
--
-- This migration is the rules. The approach footage itself does not exist
-- yet: `finish_scan_job` still refuses an `approach` artifact, and widening
-- it belongs with the slice that teaches the worker to build one.

CREATE TYPE public.approach_visibility AS ENUM ('confirmed_stay', 'everyone');

ALTER TABLE public.listings
  ADD COLUMN approach_visibility public.approach_visibility NOT NULL DEFAULT 'confirmed_stay';

-- The host's own setting, so it joins the column list 0019 replaced the
-- table-level grant with.
GRANT UPDATE (approach_visibility) ON public.listings TO app_user;

INSERT INTO public.app_config (key, value) VALUES
  ('street_pin_precision_m', '150')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------- rounding ------

-- A grid cell, in degrees, sized in metres. The longitude step is scaled by
-- the latitude band's cosine so a cell is roughly square on the ground; the
-- cosine is floored so a listing near a pole cannot divide by zero.
--
-- The band is taken from the *rounded* latitude, so every point inside a cell
-- resolves to that cell rather than to a step that shifts with the input.
CREATE OR REPLACE FUNCTION app.round_pin(
  p_lat double precision,
  p_lng double precision,
  p_meters integer
)
RETURNS TABLE (lat double precision, lng double precision)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH lat_step AS (
    SELECT GREATEST(p_meters, 1)::double precision / 111320.0 AS step
  ),
  rounded_lat AS (
    SELECT round((p_lat / step)::numeric)::double precision * step AS value FROM lat_step
  ),
  lng_step AS (
    SELECT GREATEST(p_meters, 1)::double precision
             / (111320.0 * GREATEST(cos(radians((SELECT value FROM rounded_lat))), 0.01)) AS step
  )
  SELECT (SELECT value FROM rounded_lat),
         round((p_lng / (SELECT step FROM lng_step))::numeric)::double precision
           * (SELECT step FROM lng_step);
$$;

REVOKE ALL ON FUNCTION app.round_pin(double precision, double precision, integer) FROM PUBLIC;

-- ------------------------------------------------------- the entitlement ---

-- Whether this viewer may see the front door of this listing: its own host
-- always, anyone when the host opened it, and otherwise a guest whose stay
-- here is confirmed or later. The status set is the one `addressIsShared`
-- keeps in TypeScript — a stay that never happened (pending, expired) or was
-- given back (canceled) is not a stay — and a test asserts the two agree
-- rather than trusting that they were written on the same day.
CREATE OR REPLACE FUNCTION app.viewer_sees_door(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.listings l
     WHERE l.id = p_listing_id
       AND (l.host_id = app.current_user_id() OR l.approach_visibility = 'everyone')
  ) OR EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.listing_id = p_listing_id
       AND b.guest_id = app.current_user_id()
       AND b.status IN ('confirmed', 'checked_in', 'completed')
  );
$$;

REVOKE ALL ON FUNCTION app.viewer_sees_door(uuid) FROM PUBLIC;

-- ---------------------------------------------------------- the street -----

-- What the listing page may say about where this home is and what the host
-- filmed outside it. One door, like the walkthrough's: it opens for an active
-- listing or for that listing's own host, and closes for everyone else.
--
-- The pin is absent until the host has confirmed the point (HM-01). An
-- unconfirmed lat/lng is a half-typed field, and drawing it would be drawing
-- something nobody stood at.
--
-- `has_approach` says whether footage exists; `sees_door` says whether this
-- viewer may watch it. Both are needed: the page distinguishes "the host
-- shows this after a stay is confirmed" from "nobody filmed this", and those
-- are different truths.
CREATE OR REPLACE FUNCTION app.street_for_viewer(p_listing_id uuid)
RETURNS TABLE (
  pin_lat double precision,
  pin_lng double precision,
  precision_m integer,
  sees_door boolean,
  has_approach boolean,
  owner_preview boolean,
  approach_keys text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH grid AS (
    SELECT GREATEST(COALESCE((SELECT value::integer FROM public.app_config
                               WHERE key = 'street_pin_precision_m'), 150), 1) AS meters
  ),
  viewer AS (
    SELECT l.id,
           l.lat,
           l.lng,
           l.coordinates_confirmed_at,
           l.status,
           l.host_id,
           app.viewer_sees_door(l.id) AS sees_door,
           COALESCE(
             (SELECT array_agg(a.object_key ORDER BY a.object_key)
                FROM public.listing_scans s
                JOIN public.scan_artifacts a ON a.scan_id = s.id AND a.kind = 'approach'
               WHERE s.id = l.verified_scan_id
                 AND s.state = 'verified'),
             ARRAY[]::text[]
           ) AS approach_keys
      FROM public.listings l
     WHERE l.id = p_listing_id
       AND (l.status = 'active' OR l.host_id = app.current_user_id())
  )
  SELECT CASE
           WHEN v.coordinates_confirmed_at IS NULL OR v.lat IS NULL OR v.lng IS NULL THEN NULL
           WHEN v.sees_door THEN v.lat
           ELSE (SELECT r.lat FROM app.round_pin(v.lat, v.lng, (SELECT meters FROM grid)) r)
         END,
         CASE
           WHEN v.coordinates_confirmed_at IS NULL OR v.lat IS NULL OR v.lng IS NULL THEN NULL
           WHEN v.sees_door THEN v.lng
           ELSE (SELECT r.lng FROM app.round_pin(v.lat, v.lng, (SELECT meters FROM grid)) r)
         END,
         CASE WHEN v.sees_door THEN 0 ELSE (SELECT meters FROM grid) END,
         v.sees_door,
         array_length(v.approach_keys, 1) IS NOT NULL,
         v.status <> 'active',
         -- Existence is public; the keys are not. A viewer who may not watch
         -- the approach is told it exists and handed nothing to fetch.
         CASE WHEN v.sees_door THEN v.approach_keys ELSE ARRAY[]::text[] END
    FROM viewer v;
$$;

REVOKE ALL ON FUNCTION app.street_for_viewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.street_for_viewer(uuid) TO app_user;
