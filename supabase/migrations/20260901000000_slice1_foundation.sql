-- Slice 1 — Foundation: config, profiles, listings, bookings.
-- Scoped to the tables Slice 1 actually uses; escrow, claims, reviews,
-- payouts and trust_stats arrive in their own slices as new migrations.
-- Append-only: never edit this file once it has been applied.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- enums

create type listing_type as enum ('entire_home', 'apartment', 'private_room');
create type cancellation_policy as enum ('flexible', 'moderate', 'strict');
create type listing_status as enum ('draft', 'active', 'paused');
create type booking_status as enum (
  'pending_payment', 'confirmed', 'checked_in', 'completed',
  'canceled_by_guest', 'canceled_by_host', 'expired'
);

-- ----------------------------------------------------------- app_config

create table app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value) values
  ('network_fee_bps',            '200'::jsonb),
  ('processing_passthrough',     'false'::jsonb),
  ('claim_window_hours',         '48'::jsonb),
  ('deposit_auth_max_nights',    '4'::jsonb),
  ('pending_payment_ttl_minutes','30'::jsonb),
  ('checkin_local_time',         '"16:00"'::jsonb),
  ('checkout_local_time',        '"11:00"'::jsonb);

-- ------------------------------------------------------------- profiles

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  is_host boolean not null default false,
  phone_verified boolean not null default false,
  id_verified boolean not null default false,
  member_since timestamptz not null default now()
);

-- Magic-link signup creates the auth user; mirror it into profiles so the
-- rest of the schema can foreign-key against a row that always exists.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- listings

create table listings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  description text,
  type listing_type not null,
  address_line text,
  city text not null,
  region text,
  country text not null,
  lat double precision,
  lng double precision,
  timezone text not null,
  nightly_rate_cents integer not null check (nightly_rate_cents > 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0),
  max_guests integer not null check (max_guests > 0),
  amenities jsonb not null default '[]'::jsonb,
  instant_book boolean not null default false,
  cancellation_policy cancellation_policy not null default 'moderate',
  status listing_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index listings_active_idx on listings (status) where status = 'active';
create index listings_host_idx on listings (host_id);

create table listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create index listing_photos_listing_idx on listing_photos (listing_id, sort_order);

create table listing_blackouts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  constraint blackout_dates_ordered check (end_date > start_date)
);

create index listing_blackouts_listing_idx on listing_blackouts (listing_id);

-- ------------------------------------------------------------- bookings

create table bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  guest_id uuid not null references profiles (id) on delete restrict,
  check_in date not null,
  check_out date not null,
  guests integer not null check (guests > 0),
  nights integer not null check (nights > 0),
  nightly_rate_cents integer not null check (nightly_rate_cents > 0),
  stay_subtotal_cents integer not null check (stay_subtotal_cents >= 0),
  network_fee_cents integer not null check (network_fee_cents >= 0),
  guest_total_cents integer not null check (guest_total_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  cancellation_policy cancellation_policy not null,
  status booking_status not null default 'pending_payment',
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  stay daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  constraint booking_dates_ordered check (check_out > check_in),
  -- Availability is enforced here, never by check-then-insert in app code.
  constraint bookings_no_overlap exclude using gist (
    listing_id with =,
    stay with &&
  ) where (status in ('pending_payment', 'confirmed', 'checked_in'))
);

create index bookings_guest_idx on bookings (guest_id, created_at desc);
create index bookings_listing_idx on bookings (listing_id);
create index bookings_pending_idx on bookings (created_at)
  where status = 'pending_payment';

-- -------------------------------------------------------- stripe_events

-- Webhook idempotency: insert the event id first, skip if already present.
create table stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- ============================================================== RLS ====
-- Deny by default on every table. Enabling RLS with no policy for a verb
-- denies that verb; money and state writes go through edge functions using
-- the service role, which bypasses RLS entirely.

alter table app_config        enable row level security;
alter table profiles          enable row level security;
alter table listings          enable row level security;
alter table listing_photos    enable row level security;
alter table listing_blackouts enable row level security;
alter table bookings          enable row level security;
alter table stripe_events     enable row level security;

-- app_config: readable so the client can render fee math it cannot forge;
-- the authoritative copy is snapshotted onto the booking server-side.
create policy app_config_read on app_config
  for select using (true);

-- profiles: public read (host identity on listings), self-service update.
create policy profiles_read on profiles
  for select using (true);

create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- listings: anyone reads active listings; hosts fully manage their own.
create policy listings_read_active on listings
  for select using (status = 'active' or host_id = auth.uid());

create policy listings_insert_own on listings
  for insert with check (host_id = auth.uid());

create policy listings_update_own on listings
  for update using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy listings_delete_own on listings
  for delete using (host_id = auth.uid());

-- listing_photos / listing_blackouts inherit their parent's visibility.
create policy listing_photos_read on listing_photos
  for select using (
    exists (
      select 1 from listings l
      where l.id = listing_photos.listing_id
        and (l.status = 'active' or l.host_id = auth.uid())
    )
  );

create policy listing_photos_write_own on listing_photos
  for all using (
    exists (select 1 from listings l where l.id = listing_photos.listing_id and l.host_id = auth.uid())
  ) with check (
    exists (select 1 from listings l where l.id = listing_photos.listing_id and l.host_id = auth.uid())
  );

create policy listing_blackouts_read on listing_blackouts
  for select using (
    exists (
      select 1 from listings l
      where l.id = listing_blackouts.listing_id
        and (l.status = 'active' or l.host_id = auth.uid())
    )
  );

create policy listing_blackouts_write_own on listing_blackouts
  for all using (
    exists (select 1 from listings l where l.id = listing_blackouts.listing_id and l.host_id = auth.uid())
  ) with check (
    exists (select 1 from listings l where l.id = listing_blackouts.listing_id and l.host_id = auth.uid())
  );

-- bookings: visible to the guest and to the listing's host. No client
-- insert/update/delete policy exists, so all writes are denied — booking
-- creation and every status transition run in edge functions.
create policy bookings_read_participants on bookings
  for select using (
    guest_id = auth.uid()
    or exists (
      select 1 from listings l
      where l.id = bookings.listing_id and l.host_id = auth.uid()
    )
  );

-- stripe_events: no policies at all — service role only.
