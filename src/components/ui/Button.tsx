import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control border text-center font-semibold leading-snug no-underline transition-colors duration-fast motion-reduce:transition-none";

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-control px-5 py-3 text-[0.9375rem]",
  sm: "min-h-control-sm px-4 py-2 text-sm",
};

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover hover:text-white",
  secondary: "border-control bg-canvas text-ink hover:bg-surface hover:text-ink",
  quiet: "border-transparent bg-transparent text-brand hover:bg-surface hover:text-brand-hover",
  danger:
    "border-danger bg-danger text-white hover:border-[#8F2C21] hover:bg-[#8F2C21] hover:text-white",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return [BASE, SIZE[size], VARIANT[variant], block ? "w-full" : "", className]
    .filter(Boolean)
    .join(" ");
}

/**
 * Stable-width busy state: both labels occupy the same grid cell, so swapping
 * the text does not move anything around it.
 */
function Label({ children, busy, busyLabel }: { children: ReactNode; busy: boolean; busyLabel?: string }) {
  if (!busyLabel) return <>{children}</>;
  return (
    <span className="grid">
      <span className={`[grid-area:1/1] ${busy ? "invisible" : ""}`} aria-hidden={busy}>
        {children}
      </span>
      <span className={`[grid-area:1/1] ${busy ? "" : "invisible"}`} aria-hidden={!busy}>
        {busyLabel}
      </span>
    </span>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** While true the control is disabled and shows `busyLabel` in place of its text. */
  busy?: boolean;
  busyLabel?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, busy = false, busyLabel, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={buttonClass({ variant, size, block, className: `${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60` })}
      {...rest}
    >
      <Label busy={busy} busyLabel={busyLabel}>
        {children}
      </Label>
    </button>
  );
});

export type ButtonLinkProps = LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

/** A route link that looks like a button. Never use it for a mutation. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size, block, className, children, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClass({ variant, size, block, className })} {...rest}>
      {children}
    </Link>
  );
});
