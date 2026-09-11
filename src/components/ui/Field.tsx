import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Form fields with a persistent visible label, an optional hint and an error
 * that is wired to the control through aria-describedby / aria-invalid.
 */
type FieldChrome = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Marks the label "(optional)". Required is the default and is not decorated. */
  optional?: boolean;
  /** Extra classes for the outer wrapper, e.g. a grid column span. */
  wrapperClassName?: string;
};

const CONTROL =
  "w-full rounded-control border bg-canvas px-3.5 text-base text-ink placeholder:text-ink-secondary disabled:bg-surface disabled:text-ink-secondary";

function controlClass(error: boolean, extra?: string): string {
  return [CONTROL, error ? "border-danger" : "border-control", extra ?? ""].join(" ");
}

function useFieldIds(explicitId?: string) {
  const generated = useId();
  const id = explicitId ?? `field-${generated}`;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

function describedBy(hint: boolean, error: boolean, ids: { hintId: string; errorId: string }): string | undefined {
  const parts = [hint ? ids.hintId : null, error ? ids.errorId : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function Chrome({
  ids,
  label,
  hint,
  error,
  optional,
  wrapperClassName,
  children,
}: FieldChrome & { ids: ReturnType<typeof useFieldIds>; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 ${wrapperClassName ?? ""}`}>
      <label htmlFor={ids.id} className="text-sm font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-secondary"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={ids.hintId} className="m-0 text-sm text-ink-secondary">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={ids.errorId} className="m-0 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> &
  FieldChrome & { id?: string };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { id, label, hint, error, optional, wrapperClassName, className, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <Chrome ids={ids} label={label} hint={hint} error={error} optional={optional} wrapperClassName={wrapperClassName}>
      <input
        ref={ref}
        id={ids.id}
        aria-describedby={describedBy(Boolean(hint), Boolean(error), ids)}
        aria-invalid={error ? true : undefined}
        className={controlClass(Boolean(error), `min-h-control py-3 ${className ?? ""}`)}
        {...rest}
      />
    </Chrome>
  );
});

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> &
  FieldChrome & { id?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, hint, error, optional, wrapperClassName, className, children, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <Chrome ids={ids} label={label} hint={hint} error={error} optional={optional} wrapperClassName={wrapperClassName}>
      <select
        ref={ref}
        id={ids.id}
        aria-describedby={describedBy(Boolean(hint), Boolean(error), ids)}
        aria-invalid={error ? true : undefined}
        className={controlClass(Boolean(error), `min-h-control cursor-pointer py-3 ${className ?? ""}`)}
        {...rest}
      >
        {children}
      </select>
    </Chrome>
  );
});

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> &
  FieldChrome & { id?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { id, label, hint, error, optional, wrapperClassName, className, rows = 4, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <Chrome ids={ids} label={label} hint={hint} error={error} optional={optional} wrapperClassName={wrapperClassName}>
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        aria-describedby={describedBy(Boolean(hint), Boolean(error), ids)}
        aria-invalid={error ? true : undefined}
        className={controlClass(Boolean(error), `min-h-[128px] resize-y py-3 ${className ?? ""}`)}
        {...rest}
      />
    </Chrome>
  );
});

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  type?: "checkbox" | "radio";
};

/** Native checkbox or radio with a generous label target. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { id, label, hint, error, type = "checkbox", className, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.id} className="flex min-h-[44px] cursor-pointer items-start gap-3 text-base text-ink">
        <input
          ref={ref}
          id={ids.id}
          type={type}
          aria-describedby={describedBy(Boolean(hint), Boolean(error), ids)}
          aria-invalid={error ? true : undefined}
          className={`mt-1 h-5 w-5 shrink-0 accent-brand ${className ?? ""}`}
          {...rest}
        />
        <span className="flex flex-col gap-0.5 py-2.5">
          <span>{label}</span>
          {hint ? (
            <span id={ids.hintId} className="text-sm text-ink-secondary">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={ids.errorId} className="m-0 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
