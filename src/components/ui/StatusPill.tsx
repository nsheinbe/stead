import type { ReactNode } from "react";

export type PillTone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONE: Record<PillTone, string> = {
  neutral: "bg-surface text-ink-secondary",
  brand: "bg-surface-accent text-brand",
  success: "bg-surface-accent text-brand",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
};

/** Fully rounded status label. The text is the status; colour only reinforces it. */
export function StatusPill({
  tone = "neutral",
  children,
  className = "",
  testId,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
