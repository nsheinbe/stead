import { DEPOSIT_ON_CANCEL, POLICY_RULES } from "../lib/cancellation";
import { POLICY_LABEL, type CancellationPolicy } from "../lib/types";

export function CancellationPolicyCard({
  policy,
  compact = false,
}: {
  policy: CancellationPolicy;
  compact?: boolean;
}) {
  const rules = POLICY_RULES[policy];
  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] border border-linen-tint px-4 py-3.5"
      data-testid="cancellation-policy"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] font-bold tracking-[0.12em] text-ink/50">CANCELLATION</span>
        <span className="text-[12.5px] font-bold">{POLICY_LABEL[policy]}</span>
      </div>
      <ul className={`m-0 flex list-none flex-col gap-1.5 p-0 ${compact ? "text-[12px]" : "text-[12.5px]"} leading-relaxed text-ink/70`}>
        {rules.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="m-0 text-[12px] leading-relaxed text-ink/55">{DEPOSIT_ON_CANCEL}</p>
    </div>
  );
}
