-- SAFE-01: let an arbiter actually read the claim they are asked to resolve.
--
-- 0007 gave arbiters read access to `claims` and `escrow_deposits`, but not to
-- `bookings` or `listings`. Every query that renders a claim joins those two
-- for the dates and the home's title, so `getClaimForViewer` returned zero
-- rows for an arbiter: the one person with `canResolve` could not open the
-- page. The gate was right and the join defeated it.
--
-- This widens as little as possible. An arbiter sees a booking only when a
-- claim exists against it, and a listing only when one of its bookings has a
-- claim. Everything else stays deny-by-default, and the existing party
-- policies are untouched — SELECT policies are OR'd, so this is additive.
--
-- The two helpers are SECURITY DEFINER on purpose. A policy on `bookings`
-- whose USING clause selected from `claims` would recurse, because the
-- `claims` policy already selects from `bookings`; Postgres raises "infinite
-- recursion detected in policy for relation". Running the lookup as the owner
-- breaks that cycle, exactly as `app.booking_has_open_dispute` does.

-- --------------------------------------------------------- helpers ---------

CREATE OR REPLACE FUNCTION app.booking_has_claim(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c WHERE c.booking_id = p_booking_id
  )
$$;

REVOKE ALL ON FUNCTION app.booking_has_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.booking_has_claim(uuid) TO app_user;

CREATE OR REPLACE FUNCTION app.listing_has_claim(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.claims c
      JOIN public.bookings b ON b.id = c.booking_id
     WHERE b.listing_id = p_listing_id
  )
$$;

REVOKE ALL ON FUNCTION app.listing_has_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.listing_has_claim(uuid) TO app_user;

-- -------------------------------------------------------- policies ---------

-- Read-only, and only where a claim exists. An arbiter gains no INSERT,
-- UPDATE or DELETE anywhere from this migration.
CREATE POLICY bookings_arbiter_claim_read ON public.bookings
  FOR SELECT TO app_user
  USING (
    app.is_current_user_arbiter()
    AND app.booking_has_claim(id)
  );

CREATE POLICY listings_arbiter_claim_read ON public.listings
  FOR SELECT TO app_user
  USING (
    app.is_current_user_arbiter()
    AND app.listing_has_claim(id)
  );
