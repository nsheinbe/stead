import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  compareStayFees,
  FEE_SLIDER_DEFAULT_NIGHTS,
  FEE_SLIDER_DEFAULT_RATE_CENTS,
  FEE_SLIDER_MAX_NIGHTS,
  FEE_SLIDER_MAX_RATE_CENTS,
  FEE_SLIDER_MIN_NIGHTS,
  FEE_SLIDER_MIN_RATE_CENTS,
  FEE_SLIDER_RATE_STEP_CENTS,
  formatUsd,
} from "../lib/money";

function SliderRow({
  id,
  label,
  valueText,
  min,
  max,
  step,
  value,
  onChange,
}: {
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[15px] font-semibold text-ink/62">
          {label}
        </label>
        <span className="money text-[28px] font-bold" aria-live="polite">
          {valueText}
        </span>
      </div>
      <input
        id={id}
        className="fee-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function FeeCompare() {
  const rateId = useId();
  const nightsId = useId();
  const [rateCents, setRateCents] = useState(FEE_SLIDER_DEFAULT_RATE_CENTS);
  const [nights, setNights] = useState(FEE_SLIDER_DEFAULT_NIGHTS);
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });
  const feeBps = config.data?.networkFeeBps ?? 200;

  const compare = useMemo(
    () =>
      compareStayFees({
        nightlyRateCents: rateCents,
        nights,
        networkFeeBps: feeBps,
      }),
    [rateCents, nights, feeBps],
  );

  const takePct = Math.round(compare.platformTakeBps / 100);
  const mathLine = `${formatUsd(compare.nightlyRateCents)} × ${compare.nights} nights = ${formatUsd(compare.staySubtotalCents)}`;

  return (
    <div className="grid items-stretch gap-9 lg:grid-cols-[392px_1fr]">
      <div className="flex flex-col gap-8 rounded-card bg-linen p-9">
        <SliderRow
          id={rateId}
          label="Nightly rate"
          valueText={formatUsd(compare.nightlyRateCents)}
          min={FEE_SLIDER_MIN_RATE_CENTS}
          max={FEE_SLIDER_MAX_RATE_CENTS}
          step={FEE_SLIDER_RATE_STEP_CENTS}
          value={rateCents}
          onChange={setRateCents}
        />
        <SliderRow
          id={nightsId}
          label="Nights"
          valueText={String(compare.nights)}
          min={FEE_SLIDER_MIN_NIGHTS}
          max={FEE_SLIDER_MAX_NIGHTS}
          step={1}
          value={nights}
          onChange={setNights}
        />
        <div className="mt-auto flex flex-col items-center gap-1 rounded-xl bg-paper p-5">
          <span className="money text-[23px] font-bold tracking-wide">{mathLine}</span>
          <span className="text-[13.5px] text-ink/55">what the stay is actually worth</span>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-5 rounded-card bg-spruce px-8 py-[30px] text-paper">
            <div className="flex items-center justify-between">
              <span className="font-display text-[23px] font-semibold">Stead</span>
              <span className="rounded-full bg-brass-light px-2.5 py-1 text-xs font-bold tracking-[0.14em] text-ink">
                2% FLAT
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15.5px] text-paper/72">Guest pays, all-in</span>
              <span className="money text-[30px] font-bold">{formatUsd(compare.steadGuestCents)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15.5px] text-paper/72">Host receives</span>
              <span className="money text-[30px] font-bold">{formatUsd(compare.steadHostCents)}</span>
            </div>
            <div className="h-px bg-paper/18" />
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[14.5px] text-paper/72">Network fee — payments, verification, arbitration</span>
              <span className="money text-lg font-bold">{formatUsd(compare.networkFeeCents)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-5 rounded-card border border-[#E5DDCA] bg-paper px-8 py-[30px]">
            <div className="flex items-center justify-between">
              <span className="font-display text-[23px] font-semibold text-ink/75">A typical platform</span>
              <span className="rounded-full border border-[#D8CDB6] px-2.5 py-1 text-xs font-bold tracking-[0.14em] text-ink/60">
                ~{takePct}% TAKE
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15.5px] text-ink/60">Guest pays, all-in</span>
              <span className="money text-[30px] font-bold text-ink/82">{formatUsd(compare.otherGuestCents)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15.5px] text-ink/60">Host receives</span>
              <span className="money text-[30px] font-bold text-ink/82">{formatUsd(compare.otherHostCents)}</span>
            </div>
            <div className="h-px bg-[#EAE2D0]" />
            <div className="flex items-baseline justify-between">
              <span className="text-[14.5px] text-ink/60">Lost to the middle</span>
              <span className="money text-lg font-bold text-ink/55 line-through decoration-claim/55">
                {formatUsd(compare.otherTakeCents)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start gap-4 rounded-card bg-linen px-10 py-6 md:flex-row md:items-center md:gap-9">
          <span className="money font-display text-[64px] font-bold leading-none text-spruce">
            {formatUsd(compare.staysBetweenCents)}
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[19px] font-bold">stays between you and your host — every single stay.</span>
            <span className="money text-[15px] text-ink/62">
              {formatUsd(compare.guestSavesCents)} back in the guest's pocket · {formatUsd(compare.hostGainsCents)} more
              to the host.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
