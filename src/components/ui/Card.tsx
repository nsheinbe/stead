import type { ElementType, HTMLAttributes, ReactNode } from "react";

type Padding = "none" | "sm" | "md" | "lg";

const PAD: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

type BoxProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  padding?: Padding;
  children: ReactNode;
};

/** White card with a hairline border. No shadow: hierarchy comes from layout. */
export function Card({ as: Tag = "div", padding = "md", className = "", children, ...rest }: BoxProps) {
  return (
    <Tag className={`rounded-card border border-divider bg-canvas ${PAD[padding]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Cool-gray grouped surface for secondary panels. */
export function Surface({ as: Tag = "div", padding = "md", className = "", children, ...rest }: BoxProps) {
  return (
    <Tag className={`rounded-surface bg-surface ${PAD[padding]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Accent surface for a selected state or quiet success information. */
export function AccentSurface({ as: Tag = "div", padding = "md", className = "", children, ...rest }: BoxProps) {
  return (
    <Tag className={`rounded-surface bg-surface-accent ${PAD[padding]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
