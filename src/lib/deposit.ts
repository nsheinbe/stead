/**
 * Which deposit arrangement a stay of this length gets.
 *
 * The server decides this for a real booking (`depositMethod` in
 * server/lib/pricing.ts, using the configured `deposit_auth_max_nights`), and
 * its answer is what the UI must render. This helper exists only for the
 * pre-booking estimate on a listing page, where no server quote exists yet.
 *
 * The cap is a card-authorization lifetime (~7 days), so it is always far
 * below the 30-night minimum: every real stay is card-on-file today. The
 * default is repeated here rather than assumed silently, and any live quote
 * response overrides it.
 */
import { MIN_STAY_NIGHTS } from "./money";
import type { DepositMethod } from "./types";

const DEFAULT_AUTH_MAX_NIGHTS = 4;

export function depositMethodForNights(
  nights: number,
  depositAuthMaxNights: number = DEFAULT_AUTH_MAX_NIGHTS,
): DepositMethod {
  return nights <= depositAuthMaxNights ? "auth_hold" : "card_on_file";
}

/** Every bookable stay is at least the minimum, so this is the standing case. */
export const MINIMUM_STAY_DEPOSIT_METHOD: DepositMethod = depositMethodForNights(MIN_STAY_NIGHTS);
