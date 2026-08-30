-- Slice 1 foundation: profiles, listings, bookings, fee policy, escrow row,
-- stripe_events idempotency, expire-pending. RLS deny-by-default on every table.
-- Money is integer cents. Availability is the gist exclusion constraint — never
-- check-then-insert in application code.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
CREATE TYPE public.listing_type AS ENUM ('entire_home', 'apartment', 'private_room');
CREATE TYPE public.cancellation_policy AS ENUM ('flexible', 'moderate', 'strict');
CREATE TYPE public.listing_status AS ENUM ('draft', 'active', 'paused');
CREATE TYPE public.booking_status AS ENUM (
  'pending_payment',
  'confirmed',
  'checked_in',
  'completed',
  'canceled_by_guest',
  'canceled_by_host',
  'expired'
);
CREATE TYPE public.escrow_state AS ENUM (
  'scheduled',
  'held',
  'claim_window',
  'released',
  'claimed',
  'disputed',
  'arbitrated'
);
CREATE TYPE public.escrow_method AS ENUM ('auth_hold', 'card_on_file');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  is_host boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  id_verified boolean NOT NULL DEFAULT false,
  member_since timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  type public.listing_type NOT NULL,
  address_line text NOT NULL DEFAULT '',
  city text NOT NULL,
  region text NOT NULL DEFAULT '',
  country text NOT NULL,
  lat double precision,
  lng double precision,
  timezone text NOT NULL,
  nightly_rate_cents integer NOT NULL CHECK (nightly_rate_cents > 0),
  deposit_cents integer NOT NULL CHECK (deposit_cents >= 0),
  max_guests integer NOT NULL CHECK (max_guests > 0),
  amenities jsonb NOT NULL DEFAULT '{}'::jsonb,
  instant_book boolean NOT NULL DEFAULT false,
  cancellation_policy public.cancellation_policy NOT NULL DEFAULT 'moderate',
  status public.listing_status NOT NULL DEFAULT 'draft'
);

CREATE TABLE public.listing_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.listing_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  CHECK (end_date > start_date)
);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE RESTRICT,
  guest_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  check_in date NOT NULL,
  check_out date NOT NULL,
  guests integer NOT NULL CHECK (guests > 0),
  nights integer NOT NULL CHECK (nights > 0),
  nightly_rate_cents integer NOT NULL CHECK (nightly_rate_cents > 0),
  stay_subtotal_cents integer NOT NULL CHECK (stay_subtotal_cents >= 0),
  network_fee_cents integer NOT NULL CHECK (network_fee_cents >= 0),
  guest_total_cents integer NOT NULL CHECK (guest_total_cents >= 0),
  deposit_cents integer NOT NULL CHECK (deposit_cents >= 0),
  cancellation_policy public.cancellation_policy NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending_payment',
  stripe_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  stay daterange GENERATED ALWAYS AS (daterange(check_in, check_out, '[)')) STORED,
  CONSTRAINT bookings_dates_ok CHECK (check_out > check_in),
  CONSTRAINT bookings_nights_match CHECK (nights = (check_out - check_in)),
  CONSTRAINT bookings_guest_total_match CHECK (
    guest_total_cents = stay_subtotal_cents + network_fee_cents
  ),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    listing_id WITH =,
    stay WITH &&
  ) WHERE (status IN ('pending_payment', 'confirmed', 'checked_in'))
);

CREATE TABLE public.escrow_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  state public.escrow_state NOT NULL DEFAULT 'scheduled',
  method public.escrow_method NOT NULL,
  stripe_setup_intent_id text,
  stripe_auth_pi_id text,
  held_at timestamptz,
  window_closes_at timestamptz,
  released_at timestamptz,
  resolved_amount_cents integer
);

CREATE TABLE public.escrow_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL REFERENCES public.escrow_deposits (id) ON DELETE CASCADE,
  from_state public.escrow_state,
  to_state public.escrow_state NOT NULL,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cron_heartbeats (
  job text PRIMARY KEY,
  last_ok timestamptz,
  last_error text
);

-- Fee policy lives here, not in client code. Snapshot computed amounts onto bookings.
INSERT INTO public.app_config (key, value) VALUES
  ('network_fee_bps', '200'),
  ('processing_passthrough', 'false'),
  ('claim_window_hours', '48'),
  ('deposit_auth_max_nights', '4'),
  ('pending_payment_ttl_minutes', '30'),
  ('checkin_local_time', '"16:00"'),
  ('checkout_local_time', '"11:00"');

-- ---------------------------------------------------------------------------
-- Profile from Auth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1), ''),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Expire abandoned checkouts so gist dates are not held hostage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_pending_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ttl integer;
  n integer;
BEGIN
  SELECT COALESCE((value #>> '{}')::integer, 30)
    INTO ttl
    FROM public.app_config
   WHERE key = 'pending_payment_ttl_minutes';

  IF ttl IS NULL OR ttl < 1 THEN
    ttl := 30;
  END IF;

  UPDATE public.bookings
     SET status = 'expired'
   WHERE status = 'pending_payment'
     AND created_at < now() - make_interval(mins => ttl);

  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.cron_heartbeats (job, last_ok, last_error)
  VALUES ('expire-pending', now(), NULL)
  ON CONFLICT (job) DO UPDATE
    SET last_ok = excluded.last_ok,
        last_error = NULL;

  RETURN n;
END;
$$;

-- Confirm a stay after the guest PaymentIntent succeeds (webhook / service role).
CREATE OR REPLACE FUNCTION public.confirm_booking_for_payment_intent(pi_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE public.bookings
     SET status = 'confirmed'
   WHERE stripe_payment_intent_id = pi_id
     AND status = 'pending_payment';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS — deny by default; client writes to money/state tables are denied
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

ALTER TABLE public.app_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.listings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.listing_photos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.listing_blackouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_deposits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cron_heartbeats FORCE ROW LEVEL SECURITY;

-- app_config: public read (fee policy is not a secret)
CREATE POLICY app_config_public_read ON public.app_config
  FOR SELECT TO anon, authenticated
  USING (true);

-- profiles: anyone can read a member card; members update their own row
CREATE POLICY profiles_public_read ON public.profiles
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- listings: active listings are public; hosts CRUD their own (writes used from S3)
CREATE POLICY listings_public_read_active ON public.listings
  FOR SELECT TO anon, authenticated
  USING (status = 'active' OR host_id = auth.uid());

CREATE POLICY listings_host_insert ON public.listings
  FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid());

CREATE POLICY listings_host_update ON public.listings
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

CREATE POLICY listings_host_delete ON public.listings
  FOR DELETE TO authenticated
  USING (host_id = auth.uid());

CREATE POLICY listing_photos_public_read ON public.listing_photos
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND (l.status = 'active' OR l.host_id = auth.uid())
    )
  );

CREATE POLICY listing_photos_host_write ON public.listing_photos
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = auth.uid())
  );

CREATE POLICY listing_blackouts_public_read ON public.listing_blackouts
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id
         AND (l.status = 'active' OR l.host_id = auth.uid())
    )
  );

CREATE POLICY listing_blackouts_host_write ON public.listing_blackouts
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.host_id = auth.uid())
  );

-- bookings: visible to the guest and the listing host. No client writes.
CREATE POLICY bookings_party_read ON public.bookings
  FOR SELECT TO authenticated
  USING (
    guest_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.listings l
       WHERE l.id = listing_id AND l.host_id = auth.uid()
    )
  );

-- escrow: booking parties may read; writes are service-role only
CREATE POLICY escrow_party_read ON public.escrow_deposits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_id
         AND (
           b.guest_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = auth.uid()
           )
         )
    )
  );

CREATE POLICY escrow_audit_party_read ON public.escrow_audit
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.escrow_deposits d
        JOIN public.bookings b ON b.id = d.booking_id
       WHERE d.id = deposit_id
         AND (
           b.guest_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.listings l
              WHERE l.id = b.listing_id AND l.host_id = auth.uid()
           )
         )
    )
  );

-- stripe_events + cron_heartbeats: no client policies → deny

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.app_config TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.listings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.listings TO authenticated;
GRANT SELECT ON public.listing_photos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.listing_photos TO authenticated;
GRANT SELECT ON public.listing_blackouts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.listing_blackouts TO authenticated;
GRANT SELECT ON public.bookings TO authenticated;
GRANT SELECT ON public.escrow_deposits TO authenticated;
GRANT SELECT ON public.escrow_audit TO authenticated;

-- Service role (and table owner under FORCE RLS) needs bypass for edge writes.
-- Supabase's service_role bypasses RLS. Tests use a dedicated role with BYPASSRLS.
