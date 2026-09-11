import type { ReactNode } from "react";

/**
 * Explains an absence in the member's own terms and offers one next action.
 * No seed commands, environment variables or imaginary inventory.
 */
export function EmptyState({
  title,
  children,
  action,
  compact = false,
  testId,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-start gap-3 rounded-surface bg-surface ${compact ? "px-5 py-5" : "px-6 py-8 sm:px-8 sm:py-10"}`}
    >
      <h2 className={`m-0 ${compact ? "text-card-title" : "text-[1.5rem] sm:text-section-title"}`}>{title}</h2>
      {children ? <div className="max-w-reading text-base text-ink-secondary [&>p]:m-0">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap gap-3">{action}</div> : null}
    </div>
  );
}
