/**
 * Named steps for a multi-step task. An ordered list with aria-current on the
 * active step; completed steps read as done, later ones as upcoming. Steps
 * are not a substitute for form labels.
 */
export function Progress({
  steps,
  current,
  label,
}: {
  steps: readonly string[];
  /** 1-based index of the active step. */
  current: number;
  label: string;
}) {
  return (
    <ol aria-label={label} className="m-0 flex list-none gap-3 p-0 text-sm sm:gap-5">
      {steps.map((step, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "active" : "upcoming";
        return (
          <li
            key={step}
            aria-current={state === "active" ? "step" : undefined}
            className={`flex-1 border-t-[3px] pt-3 ${
              state === "upcoming" ? "border-divider text-ink-secondary" : "border-brand text-brand"
            } ${state === "active" ? "font-semibold" : ""}`}
          >
            <span className="sr-only">
              {state === "done" ? "Completed: " : state === "active" ? "Current: " : "Upcoming: "}
            </span>
            <span className="money">{number}. </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}
