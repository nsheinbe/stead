const STEPS = ["Held", "Stay", "48 h window", "Returned"] as const;

export function EscrowTimeline({ activeIndex = 0 }: { activeIndex?: number }) {
  const pct = activeIndex <= 0 ? "8%" : `${Math.min(100, (activeIndex / (STEPS.length - 1)) * 100)}%`;

  return (
    <div className="relative mt-1">
      <div className="absolute left-[7px] right-[7px] top-1.5 h-0.5 rounded-full bg-[#E4D9C0]" />
      <div className="absolute left-[7px] top-1.5 h-0.5 rounded-full bg-brass" style={{ width: pct }} />
      <div className="relative grid grid-cols-4">
        {STEPS.map((label, i) => {
          const on = i <= activeIndex;
          return (
            <div key={label} className="flex flex-col items-start gap-1">
              <span
                className={`box-border h-3.5 w-3.5 rounded-full border-2 ${
                  on ? "border-brass bg-brass" : "border-[#D8CBAC] bg-paper"
                }`}
              />
              <span className={`text-[10px] ${on ? "font-bold text-ink" : "font-semibold text-ink/50"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
