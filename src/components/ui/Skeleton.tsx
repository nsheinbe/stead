/**
 * Loading placeholders that keep the page's proportions, plus a labelled
 * status so assistive tech hears that something is loading exactly once.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-control bg-surface motion-reduce:animate-none ${className}`}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-4 ${index === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** Visible or visually-hidden loading label. Always a polite live region. */
export function LoadingStatus({ label, visible = false }: { label: string; visible?: boolean }) {
  return (
    <p role="status" className={visible ? "m-0 text-sm text-ink-secondary" : "sr-only"}>
      {label}
    </p>
  );
}
