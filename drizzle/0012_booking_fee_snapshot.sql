-- PAY-01 — snapshot the fee rate that produced a booking's money.
--
-- bookings already snapshots every amount (rate, subtotal, fee, total,
-- deposit). What it does not record is the *rate* those amounts came from, so
-- a receipt for an old booking could only be labelled with today's
-- app_config.network_fee_bps. When that value changes, every historical
-- receipt silently relabels itself and the arithmetic stops adding up on the
-- page.
--
-- Recovering the rate from rounded cents is not safe either: network_fee is
-- truncated, so several rates map to the same cents on small subtotals.
--
-- Backfill: existing rows are stamped with the configured rate, which is the
-- rate that was in force when they were written (this deployment has never
-- changed it). New rows carry their own.

ALTER TABLE public.bookings
  ADD COLUMN network_fee_bps integer;

UPDATE public.bookings
   SET network_fee_bps = COALESCE(
     (SELECT (value #>> '{}')::integer FROM public.app_config WHERE key = 'network_fee_bps'),
     200
   )
 WHERE network_fee_bps IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN network_fee_bps SET NOT NULL,
  ADD CONSTRAINT bookings_network_fee_bps_range CHECK (network_fee_bps >= 0 AND network_fee_bps <= 10000);

-- No grant change. app_user already has INSERT on bookings (the guest writes
-- its own pending_payment row and nothing else), and still has no UPDATE: the
-- enumerated SECURITY DEFINER functions remain the only state changes.
--
-- The insert policy is unchanged too — it constrains guest_id and status, and
-- this column is part of the same snapshot the guest already supplies under
-- the server's computed quote.
