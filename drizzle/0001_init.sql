-- Stead on Neon Postgres. Ported from the Supabase Slice 1 migration.
--
-- Two things could not port 1:1:
--   1. `auth.users` was a hosted Supabase table. Identity now lives in
--      public.users / accounts / sessions / verification_tokens, owned by this
--      repo and written by Auth.js. profiles hangs off public.users as before.
--   2. RLS is gone. Neon has no PostgREST in front of it and no per-request
--      `authenticated` role, so row scoping is the server's job: every query in
--      server/queries takes the session user id and filters on it. The old
--      policies are reproduced there, not here.
--
-- Everything else is the same shape: integer cents, the generated `stay`
-- daterange, and the btree_gist exclusion constraint that owns availability.

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
-- Identity (Auth.js v5 core tables)
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text NOT NULL UNIQUE,
  email_verified timestamptz,
  image text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unused while magic link is the only provider; here so the deferred Google
-- provider is a config change rather than a migration.
CREATE TABLE public.accounts (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  PRIMARY KEY (provider, provider_account_id)
);

-- Sessions are JWT-in-a-cookie, so this stays empty. The Auth.js adapter
-- contract requires the table to exist.
CREATE TABLE public.sessions (
  session_token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);

CREATE TABLE public.verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
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

CREATE INDEX listings_status_idx ON public.listings (status);

CREATE TABLE public.listing_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX listing_photos_listing_idx ON public.listing_photos (listing_id);

CREATE TABLE public.listing_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings (id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  CHECK (end_date > start_date)
);

CREATE INDEX listing_blackouts_listing_idx ON public.listing_blackouts (listing_id);

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

CREATE INDEX bookings_guest_idx ON public.bookings (guest_id);
CREATE INDEX bookings_listing_idx ON public.bookings (listing_id);
CREATE INDEX bookings_payment_intent_idx ON public.bookings (stripe_payment_intent_id);

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

CREATE INDEX escrow_audit_deposit_idx ON public.escrow_audit (deposit_id);

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
-- Every member gets a profile. Auth.js inserts into public.users; the profile
-- follows in the same transaction so no code path can observe a user without one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER on_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
