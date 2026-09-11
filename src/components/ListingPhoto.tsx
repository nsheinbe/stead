import { useState } from "react";

/**
 * A listing's photo, or an honest absence.
 *
 * There is no stock-image fallback: a home with no photo shows a neutral
 * "Photo unavailable" surface rather than a stranger's picture standing in
 * for it. The same surface appears when a real photo fails to load, so a
 * broken bucket never leaves an empty box.
 *
 * `aspect` reserves the space before the image arrives, so nothing shifts.
 */
export function ListingPhoto({
  src,
  alt,
  aspect = "4/3",
  className = "",
  sizes,
  priority = false,
}: {
  src: string | null | undefined;
  /** Empty string marks the image decorative (the title beside it names the home). */
  alt: string;
  aspect?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const missing = !src || failed;

  return (
    <div
      className={`relative overflow-hidden bg-surface ${className}`}
      style={{ aspectRatio: aspect }}
    >
      {missing ? (
        <div className="absolute inset-0 flex items-center justify-center px-3">
          <span className="text-center text-sm text-ink-secondary">Photo unavailable</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
