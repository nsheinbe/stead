import type { ReactNode } from "react";

export type StatusTone = "info" | "success" | "warning" | "danger";

const TONE: Record<StatusTone, string> = {
  info: "border-divider bg-surface text-ink",
  success: "border-surface-accent bg-surface-accent text-ink",
  warning: "border-warning/25 bg-warning-surface text-warning",
  danger: "border-danger/30 bg-danger-surface text-danger",
};

const TONE_LABEL: Record<StatusTone, string> = {
  info: "",
  success: "",
  warning: "Action needed: ",
  danger: "Problem: ",
};

/**
 * Title + what happened + a useful next action. Danger is announced as an
 * alert; everything else is a polite status. Never pass raw provider errors.
 */
export function StatusMessage({
  tone = "info",
  title,
  children,
  action,
  live = true,
  className = "",
  testId,
}: {
  tone?: StatusTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Set false for a static explanatory panel that should not be announced. */
  live?: boolean;
  className?: string;
  testId?: string;
}) {
  const role = !live ? undefined : tone === "danger" ? "alert" : "status";
  return (
    <div role={role} data-testid={testId} className={`rounded-card border px-4 py-3.5 ${TONE[tone]} ${className}`}>
      <p className="m-0 text-sm font-semibold">
        {TONE_LABEL[tone] ? <span className="sr-only">{TONE_LABEL[tone]}</span> : null}
        {title}
      </p>
      {children ? <div className="mt-1 text-sm leading-relaxed [&>p]:m-0">{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
