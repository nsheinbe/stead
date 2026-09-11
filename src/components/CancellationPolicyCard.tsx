import { DEPOSIT_ON_CANCEL, POLICY_RULES } from "../lib/cancellation";
import { Card, StatusPill } from "./ui";
import { POLICY_LABEL, type CancellationPolicy } from "../lib/types";

/**
 * The policy this booking was made under.
 *
 * The rules come from `src/lib/cancellation.ts`, the same table the server
 * prices a cancellation from, so what a member reads here and what they would
 * actually be refunded cannot drift apart.
 */
export function CancellationPolicyCard({
  policy,
  compact = false,
}: {
  policy: CancellationPolicy;
  compact?: boolean;
}) {
  const rules = POLICY_RULES[policy];
  return (
    <Card padding={compact ? "sm" : "md"} data-testid="cancellation-policy">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">Cancellation policy</h3>
        <StatusPill>{POLICY_LABEL[policy]}</StatusPill>
      </div>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-sm text-ink-secondary">
        {rules.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="m-0 mt-3 text-sm text-ink-secondary">{DEPOSIT_ON_CANCEL}</p>
    </Card>
  );
}
