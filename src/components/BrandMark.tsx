/**
 * The Stead house-and-key mark, monochrome. Colour comes from `currentColor`,
 * so wrap it in `text-brand` (default) or `text-white` on a dark surface.
 */
export function BrandMark({
  className = "h-7 w-7",
  tone = "brand",
}: {
  className?: string;
  /** `paper` is the retired name for `inverse`, kept while screens migrate. */
  tone?: "brand" | "inverse" | "paper";
}) {
  const inverse = tone === "inverse" || tone === "paper";
  return (
    <svg
      className={`${inverse ? "text-white" : "text-brand"} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 10.6 L12 3.4 L20.5 10.6 V20.5 H3.5 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.6" r="2.1" fill="currentColor" />
      <path d="M12 14.6 V17.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus wordmark, for headers and footers. */
export function BrandLockup({ tone = "brand" }: { tone?: "brand" | "inverse" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark tone={tone} className="h-[26px] w-[26px]" />
      <span className={`text-[1.5rem] font-semibold leading-none tracking-[-0.04em] ${tone === "inverse" ? "text-white" : "text-ink"}`}>
        Stead
      </span>
    </span>
  );
}
