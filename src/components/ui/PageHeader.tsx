import type { ReactNode } from "react";

/**
 * Task title first. `eyebrow` is short context (a section or place name),
 * `description` one or two plain sentences, `actions` the page's primary and
 * secondary controls. The h1 is the route-change focus target.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "md",
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const titleClass = size === "lg" ? "text-page-title sm:text-page-title-lg" : "text-[2rem] sm:text-page-title";
  return (
    <header className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? (
          <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">{eyebrow}</p>
        ) : null}
        <h1 className={`m-0 ${titleClass}`}>{title}</h1>
        {description ? <p className="m-0 max-w-reading text-body-lg text-ink-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
