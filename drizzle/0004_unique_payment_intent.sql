-- B-3 (AUDIT.md). app.confirm_booking_for_payment_intent updates the booking
-- whose stripe_payment_intent_id matches the webhook's intent. That column was
-- indexed but not unique, so a duplicate — from a bug or a replay path —
-- would confirm two bookings off one payment.
--
-- Partial on IS NOT NULL, because the id is null between insert and intent
-- creation and any number of rows may sit there at once.

CREATE UNIQUE INDEX bookings_payment_intent_key
  ON public.bookings (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Superseded: the unique index above serves the same equality lookup.
DROP INDEX IF EXISTS public.bookings_payment_intent_idx;
