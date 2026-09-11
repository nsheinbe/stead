import { DataList, DataRow, Surface } from "./ui";
import { depositExplainer, depositHeading, feeRowLabel } from "../lib/fees";
import { formatUsd } from "../lib/money";
import type { DepositMethod } from "../lib/types";

/**
 * The stay's money, as rows. The fee label is derived from the basis points
 * that produced these cents — live config for an estimate, the booking's own
 * snapshot for a receipt — so the percentage and the amount can never
 * disagree.
 *
 * `total` names what the number is: an estimate before the server has quoted,
 * the stay charge once it has. The deposit is never added into it.
 */
export function PriceBreakdown({
  nightlyRateCents,
  nights,
  staySubtotalCents,
  networkFeeCents,
  guestTotalCents,
  networkFeeBps,
  authoritative = false,
}: {
  nightlyRateCents: number;
  nights: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  guestTotalCents: number;
  networkFeeBps?: number | null;
  /** True once these numbers came from the server's quote for this stay. */
  authoritative?: boolean;
}) {
  return (
    <DataList>
      <DataRow
        label={`${nights} ${nights === 1 ? "night" : "nights"} × ${formatUsd(nightlyRateCents)}`}
        value={formatUsd(staySubtotalCents)}
      />
      <DataRow label={feeRowLabel(networkFeeBps)} value={formatUsd(networkFeeCents)} />
      <DataRow
        label={authoritative ? "Stay charge" : "Estimated stay total"}
        value={formatUsd(guestTotalCents)}
        total
        testId="stay-total"
      />
    </DataList>
  );
}

/**
 * The deposit, kept visibly apart from the stay charge. Its wording follows
 * the method the server chose, so a card-on-file arrangement is never
 * described as money held.
 */
export function DepositNote({
  amountCents,
  method,
  claimWindowHours,
}: {
  amountCents: number;
  method: DepositMethod;
  claimWindowHours?: number | null;
}) {
  return (
    <Surface padding="sm" data-testid="deposit-note">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="m-0 text-base font-semibold">{depositHeading()}</h3>
        <span className="money font-semibold">{formatUsd(amountCents)}</span>
      </div>
      <p className="m-0 mt-2 text-sm text-ink-secondary">{depositExplainer(method, amountCents)}</p>
      {typeof claimWindowHours === "number" ? (
        <p className="m-0 mt-1 text-sm text-ink-secondary">
          After checkout your host has {claimWindowHours} hours to raise a claim against it. You can respond to a
          claim before anything is charged.
        </p>
      ) : null}
    </Surface>
  );
}
