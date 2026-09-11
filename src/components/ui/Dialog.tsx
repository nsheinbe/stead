import { useEffect, useId, useRef, type ReactNode } from "react";

export type DialogVariant = "center" | "sheet";

/**
 * Native <dialog> in modal mode: the browser traps focus, Escape closes it and
 * the backdrop is inert. We add labelling, focus return to the trigger, and a
 * side-sheet variant for mobile menus.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  variant = "center",
  size = "md",
  closeLabel = "Close",
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  variant?: DialogVariant;
  size?: "sm" | "md" | "lg";
  closeLabel?: string;
  /** Keep the title for assistive tech but do not paint it (e.g. a nav sheet). */
  hideTitle?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      onClose();
      restoreTo.current?.focus();
      restoreTo.current = null;
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const widths = { sm: "sm:max-w-[420px]", md: "sm:max-w-[540px]", lg: "sm:max-w-[720px]" };
  const frame =
    variant === "sheet"
      ? "m-0 ml-auto h-full max-h-none w-[min(100%,360px)] rounded-none"
      : `m-auto w-[calc(100%-32px)] max-h-[calc(100vh-32px)] rounded-surface ${widths[size]}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={`${frame} border border-divider bg-canvas p-0 text-ink shadow-overlay`}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) ref.current?.close();
      }}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col gap-5 p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <h2 id={titleId} className={hideTitle ? "sr-only" : "m-0 text-card-title sm:text-[1.5rem]"}>
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="m-0 text-base text-ink-secondary">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-secondary hover:bg-surface hover:text-ink"
              aria-label={closeLabel}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
