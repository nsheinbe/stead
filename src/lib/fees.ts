/**
 * How money is described to members.
 *
 * The fee label always comes from a basis-points value that belongs to the
 * thing being described: the live configuration for an estimate, the
 * booking's own snapshot for a receipt. Never a hardcoded "2%", and never
 * reverse-engineered from rounded cents (truncation makes several rates
 * produce the same amount on small subtotals).
 */
import { formatUsd } from "./money";
import type { DepositMethod } from "./types";

/** "2%", "2.5%", "1.75%" — no trailing zeroes, no invented precision. */
export function feePercent(networkFeeBps: number): string {
  if (!Number.isFinite(networkFeeBps)) return "";
  const percent = networkFeeBps / 100;
  return `${percent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export function feeRowLabel(networkFeeBps: number | null | undefined): string {
  return typeof networkFeeBps === "number"
    ? `Guest network fee (${feePercent(networkFeeBps)})`
    : "Guest network fee";
}

/**
 * What the deposit arrangement actually is, per method.
 *
 * `card_on_file` is the path every 30-night stay takes under the current
 * configuration: no money moves at booking, and a charge is only possible
 * later through the claim process. Saying "held" there would describe money
 * that was never taken. `auth_hold` is a real authorization, which is still
 * not a capture.
 *
 * Both remain deliberately modest about mechanics until PAY-02 verifies the
 * processor flow end to end.
 */
export function depositExplainer(method: DepositMethod, amountCents: number): string {
  const amount = formatUsd(amountCents);
  return method === "auth_hold"
    ? `Deposit arrangement: ${amount}. Your card is authorized for this amount near check-in. An authorization is not a charge.`
    : `Deposit arrangement: ${amount}. This is separate from your stay charge and is not collected now.`;
}

export function depositHeading(): string {
  return "Deposit arrangement";
}

/** Short form for a card or summary row. */
export function depositSummary(method: DepositMethod, amountCents: number): string {
  return method === "auth_hold"
    ? `${formatUsd(amountCents)} authorized near check-in`
    : `${formatUsd(amountCents)}, separate from your stay charge`;
}
