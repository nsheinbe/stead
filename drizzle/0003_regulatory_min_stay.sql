-- Sep 2026 regulatory alignment.
--
-- 1. listings.permit_number — unused at launch, never required for booking.
-- 2. profiles.stripe_connect_account_id — host's Stripe Connect account so
--    guest_total never settles on the platform. Live charges fail closed
--    until this is set. Seed may stamp a test acct_ from
--    STRIPE_TEST_CONNECT_ACCOUNT_ID; never commit a secret.
-- 3. bookings must be ≥ 30 nights. Short stays are a 400 at quote time;
--    this constraint is the same floor in Postgres.

ALTER TABLE public.listings
  ADD COLUMN permit_number text;

ALTER TABLE public.profiles
  ADD COLUMN stripe_connect_account_id text;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_min_stay CHECK (nights >= 30);
