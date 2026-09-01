-- Restore row-level security on Neon, and give it a role that it can actually
-- bind to.
--
-- 0001 dropped the Supabase policies because there was no per-request database
-- role to hang them on. That was the wrong trade: Neon supports RLS fully and
-- at no extra cost, and database-enforced scoping is a stronger guarantee than
-- application-enforced scoping. This restores the policies and supplies the
-- missing piece — an ordinary role for tenant traffic.
--
-- Three roles, and the separation is the security boundary:
--
--   neondb_owner  owns every table. It is a neon_superuser member and HAS
--                 BYPASSRLS, so RLS does not apply to it at all. Migrations and
--                 seeding only, over the direct (non-pooled) host. Pointing
--                 tenant traffic at it silently disables everything below —
--                 which is why server/db/client.ts refuses to serve a query
--                 until it has confirmed otherwise.
--   app_user      carries tenant traffic under RLS, over the pooled host. The
--                 request's member id arrives as the transaction-local GUC
--                 app.user_id; policies read it through app.current_user_id().
--   auth_user     Auth.js only. Reaches the four identity tables and nothing
--                 else, so a bug in the sign-in path cannot see a booking and a
--                 bug in the booking path cannot see an email address.
--
-- No passwords here. `npm run db:bootstrap-roles` sets them out of band and
-- prints the connection strings once.

CREATE SCHEMA IF NOT EXISTS app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_user') THEN
    CREATE ROLE auth_user NOLOGIN;
  END IF;
END
$$;

-- Neither tenant role may bypass RLS.
--
-- This matters because a role created in the Neon console is made a
-- neon_superuser member and comes out with BYPASSRLS, so "create app_user in
-- the UI, then run the migration" would produce a role that every policy below
-- silently ignores. Strip what we can, then refuse to continue if anything is
-- left — a migration that fails loudly beats a database that looks protected.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER ROLE app_user NOBYPASSRLS NOCREATEDB NOCREATEROLE';
    EXECUTE 'ALTER ROLE auth_user NOBYPASSRLS NOCREATEDB NOCREATEROLE';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- Nothing to strip, or not ours to strip. The assertion below decides.
  END;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    BEGIN
      EXECUTE 'REVOKE neon_superuser FROM app_user, auth_user';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END
$$;

DO $$
DECLARE
  privileged text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO privileged
    FROM pg_roles
   WHERE rolname IN ('app_user', 'auth_user')
     AND (rolsuper OR rolbypassrls);

  IF privileged IS NOT NULL THEN
    RAISE EXCEPTION
      'Role(s) % can bypass row-level security, so the policies in this migration would not apply to them. '
      'Drop them and re-run this migration so they are created as ordinary roles, or run '
      'ALTER ROLE <role> NOBYPASSRLS NOSUPERUSER as a superuser.', privileged;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user, auth_user', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_user, auth_user;
GRANT USAGE ON SCHEMA app TO app_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, app_user, auth_user;

-- ---------------------------------------------------------------------------
-- The request's member, as seen by every policy below.
--
-- app.user_id is set with set_config(..., is_local => true) inside the request
-- transaction, so it cannot survive into the next request that borrows the same
-- pooled backend. Anonymous requests leave it empty and get NULL, which fails
-- every `= app.current_user_id()` comparison.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_user;

-- ---------------------------------------------------------------------------
-- Identity tables: auth_user's, and only auth_user's.
--
-- These replace Supabase's hosted `auth` schema, which no policy in the
-- original migration covered either. They are kept out of app_user's reach by
-- grant rather than by policy — there is no session yet when Auth.js looks a
-- member up by email, so any policy that permitted the sign-in flow would have
-- to permit everything.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.users, public.accounts, public.sessions, public.verification_tokens
  TO auth_user;

-- The profile follows the member. auth_user has no grant on public.profiles, so
-- the trigger has to run as its owner.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.name, ''), split_part(NEW.email, '@', 1), ''),
    NEW.image
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tenant tables: RLS on, and the grants app_user needs to reach them.
--
-- ENABLE, not FORCE. The owner is meant to bypass these — that is how
-- migrations, the seed, and the SECURITY DEFINER transitions below get their
-- work done — and the owner's credentials never carry tenant traffic.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_blackouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

-- app_config: the 2% is not a secret.
GRANT SELECT ON public.app_config TO app_user;
CREATE POLICY app_config_read ON public.app_config
  FOR SELECT TO app_user
  USING (true);

-- profiles: anyone can read a member card; members update their own row.
GRANT SELECT, UPDATE ON public.profiles TO app_user;
CREATE POLICY profiles_read ON public.profiles
  FOR SELECT TO app_user
  USING (true);
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO app_user
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

-- listings: active listings are public; hosts CRUD their own.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listings TO app_user;
CREATE POLICY listings_read_active ON public.listings
  FOR SELECT TO app_user
  USING (status = 'active' OR host_id = app.current_user_id());
CREATE POLICY listings_host_insert ON public.listings
  FOR INSERT TO app_user
  WITH CHECK (host_id = app.current_user_id());
CREATE POLICY listings_host_update ON public.listings
  FOR UPDATE TO app_user
  USING (host_id = app.current_user_id())
  WITH CHECK (host_id = app.current_user_id());
CREATE POLICY listings_host_delete ON public.listings
  FOR DELETE TO app_user
  USING (host_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_photos TO app_user;
CREATE POLICY listing_photos_read ON public.listing_photos
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND (l.status = 'active' OR l.host_id = app.current_user_id())
    )
  );
CREATE POLICY listing_photos_host_write ON public.listing_photos
  FOR ALL TO app_user
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = app.current_user_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = app.current_user_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_blackouts TO app_user;
CREATE POLICY listing_blackouts_read ON public.listing_blackouts
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND (l.status = 'active' OR l.host_id = app.current_user_id())
    )
  );
CREATE POLICY listing_blackouts_host_write ON public.listing_blackouts
  FOR ALL TO app_user
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = app.current_user_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = app.current_user_id())
  );

-- bookings: visible to the guest and the listing host. A member may open a
-- checkout for themselves and nobody else, and only in the starting state.
-- There is deliberately no UPDATE or DELETE — every transition after this goes
-- through the enumerated functions below.
GRANT SELECT, INSERT ON public.bookings TO app_user;
CREATE POLICY bookings_party_read ON public.bookings
  FOR SELECT TO app_user
  USING (
    guest_id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id AND l.host_id = app.current_user_id()
    )
  );
CREATE POLICY bookings_guest_insert ON public.bookings
  FOR INSERT TO app_user
  WITH CHECK (guest_id = app.current_user_id() AND status = 'pending_payment');

-- escrow: booking parties may read. The scheduled row is written alongside its
-- own booking; every later state change is a transition function.
GRANT SELECT, INSERT ON public.escrow_deposits TO app_user;
CREATE POLICY escrow_party_read ON public.escrow_deposits
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_id
         AND (
           b.guest_id = app.current_user_id()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = app.current_user_id()
           )
         )
    )
  );
CREATE POLICY escrow_guest_insert ON public.escrow_deposits
  FOR INSERT TO app_user
  WITH CHECK (
    state = 'scheduled'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_id
         AND b.guest_id = app.current_user_id()
         AND b.status = 'pending_payment'
    )
  );

GRANT SELECT, INSERT ON public.escrow_audit TO app_user;
CREATE POLICY escrow_audit_party_read ON public.escrow_audit
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1
        FROM public.escrow_deposits d
        JOIN public.bookings b ON b.id = d.booking_id
       WHERE d.id = deposit_id
         AND (
           b.guest_id = app.current_user_id()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = app.current_user_id()
           )
         )
    )
  );
CREATE POLICY escrow_audit_open ON public.escrow_audit
  FOR INSERT TO app_user
  WITH CHECK (
    from_state IS NULL
    AND to_state = 'scheduled'
    AND EXISTS (
      SELECT 1
        FROM public.escrow_deposits d
        JOIN public.bookings b ON b.id = d.booking_id
       WHERE d.id = deposit_id AND b.guest_id = app.current_user_id()
    )
  );

-- stripe_events and cron_heartbeats get no grant and no policy. app_user cannot
-- see or touch them; the transition functions below are the only way in.

-- ---------------------------------------------------------------------------
-- Privileged transitions.
--
-- These are what the Supabase service role used to do, except enumerated. The
-- service role could write any row on any table; app_user can perform exactly
-- these four operations and nothing else. Each runs as the table owner, so RLS
-- does not apply inside — which is the point, and the reason the list is short
-- and every function is narrow.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.record_heartbeat(p_job text, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.cron_heartbeats (job, last_ok, last_error)
  VALUES (p_job, CASE WHEN p_error IS NULL THEN now() END, p_error)
  ON CONFLICT (job) DO UPDATE
    SET last_ok = CASE WHEN p_error IS NULL THEN now() ELSE public.cron_heartbeats.last_ok END,
        last_error = p_error;
END;
$$;

-- Webhook path: pending_payment → confirmed for a settled PaymentIntent.
-- Returns false on a replay, which is what makes a redelivery harmless.
CREATE OR REPLACE FUNCTION app.confirm_booking_for_payment_intent(p_payment_intent_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE public.bookings
     SET status = 'confirmed'
   WHERE stripe_payment_intent_id = p_payment_intent_id
     AND status = 'pending_payment';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- Insert-first idempotency. False means this event id was already handled.
CREATE OR REPLACE FUNCTION app.claim_stripe_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.stripe_events (id, type)
  VALUES (p_id, p_type)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

-- Abandoned checkouts must not hold dates hostage behind the exclusion
-- constraint.
CREATE OR REPLACE FUNCTION app.expire_pending_bookings(p_ttl_minutes integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ttl integer := COALESCE(p_ttl_minutes, 30);
  expired integer;
BEGIN
  IF ttl < 1 THEN
    ttl := 30;
  END IF;

  UPDATE public.bookings
     SET status = 'expired'
   WHERE status = 'pending_payment'
     AND created_at < now() - make_interval(mins => ttl);
  GET DIAGNOSTICS expired = ROW_COUNT;

  PERFORM app.record_heartbeat('expire-pending', NULL);
  RETURN expired;
END;
$$;

REVOKE ALL ON FUNCTION app.record_heartbeat(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_booking_for_payment_intent(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_stripe_event(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expire_pending_bookings(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.record_heartbeat(text, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.confirm_booking_for_payment_intent(text) TO app_user;
GRANT EXECUTE ON FUNCTION app.claim_stripe_event(text, text) TO app_user;
GRANT EXECUTE ON FUNCTION app.expire_pending_bookings(integer) TO app_user;
