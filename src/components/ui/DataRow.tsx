import type { ReactNode } from "react";

/**
 * Label/value rows for money and facts. Rendered as a description list so the
 * pairing is programmatic; values use tabular numerals.
 */
export function DataList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`m-0 flex flex-col ${className}`}>{children}</dl>;
}

export function DataRow({
  label,
  value,
  hint,
  total = false,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Emphasised final row with a stronger top rule. */
  total?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={
        total
          ? "mt-1 flex items-baseline justify-between gap-4 border-t border-control pt-3 text-lg font-semibold"
          : "flex items-baseline justify-between gap-4 border-b border-divider py-3 last:border-b-0"
      }
    >
      <dt className={`min-w-0 ${total ? "" : "text-ink-secondary"}`}>
        {label}
        {hint ? <span className="block text-sm font-normal text-ink-secondary">{hint}</span> : null}
      </dt>
      <dd className="money m-0 shrink-0 text-right font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
