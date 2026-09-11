import { useEffect, useRef } from "react";

export type FieldErrorItem = {
  /** DOM id of the invalid control, so the link moves focus straight to it. */
  fieldId: string;
  message: string;
};

/**
 * Submit-time error summary. It takes focus when it appears so keyboard and
 * screen-reader users hear the problem before hunting for red text.
 */
export function ErrorSummary({
  title = "Check the highlighted fields",
  errors,
}: {
  title?: string;
  errors: FieldErrorItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-card border border-danger/40 bg-danger-surface px-4 py-3.5 text-danger"
    >
      <p className="m-0 text-sm font-semibold">{title}</p>
      <ul className="mb-0 mt-2 list-disc pl-5 text-sm">
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              className="text-danger underline"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.fieldId)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
