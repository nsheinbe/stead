import { formatUsd } from "../lib/money";

export function PriceBreakdown({
  nightlyRateCents,
  nights,
  staySubtotalCents,
  networkFeeCents,
  guestTotalCents,
  hostLine = false,
}: {
  nightlyRateCents: number;
  nights: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  guestTotalCents: number;
  hostLine?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-linen-tint px-4 py-3.5">
      <div className="money flex justify-between text-sm">
        <span className="text-ink/70">
          {formatUsd(nightlyRateCents)} × {nights} {nights === 1 ? "night" : "nights"}
        </span>
        <span className="font-semibold">{formatUsd(staySubtotalCents)}</span>
      </div>
      <div className="money flex justify-between text-sm">
        <span className="text-ink/70">Network fee — flat 2%</span>
        <span className="font-semibold">{formatUsd(networkFeeCents)}</span>
      </div>
      <div className="h-px bg-[#EDE5D3]" />
      <div className="money flex justify-between text-[15.5px] font-bold">
        <span>{hostLine ? `Guest pays · host gets ${formatUsd(staySubtotalCents)}` : "Total — that's it"}</span>
        <span>{formatUsd(guestTotalCents)}</span>
      </div>
    </div>
  );
}

export function DepositChip({
  amountCents,
  detail = "Held in neutral escrow — never in the host's account.",
}: {
  amountCents: number;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-brass/75 bg-brass/[0.06] px-4 py-3.5">
      <div className="flex flex-1 flex-col gap-1">
        <span className="money text-sm font-bold">Incidentals deposit · {formatUsd(amountCents)}</span>
        <span className="text-xs leading-snug text-ink/60">{detail}</span>
      </div>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-brass-deep">
        RETURNS TO YOU
      </span>
    </div>
  );
}
