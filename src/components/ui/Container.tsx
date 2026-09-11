import type { ReactNode } from "react";

export type ContainerWidth = "wide" | "narrow" | "reading" | "full";

const WIDTH: Record<ContainerWidth, string> = {
  wide: "mx-auto w-full max-w-content px-5 sm:px-8 lg:px-16",
  narrow: "mx-auto w-full max-w-narrow px-5 sm:px-8",
  reading: "mx-auto w-full max-w-reading px-5 sm:px-8",
  full: "w-full",
};

/** Shared content column. Gutters are 20px on phones, 32px, then 64px on desktop. */
export function Container({
  width = "wide",
  className = "",
  children,
}: {
  width?: ContainerWidth;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`${WIDTH[width]} ${className}`}>{children}</div>;
}
