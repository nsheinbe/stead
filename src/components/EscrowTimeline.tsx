import type { EscrowDetail, EscrowState } from "../lib/types";

const STEPS = ["Held", "Stay", "48 h window", "Returned"] as const;

/**
 * Where each escrow state sits on the bar. -1 lights nothing: a scheduled
 * deposit has not been held yet, and showing "Held" would be a lie about the
 * member's money.
 */
const STEP_FOR_STATE: Record<EscrowState, number> = {
  scheduled: -1,
  held: 1,
  claim_window: 2,
  // A claim keeps the deposit at the window stage until it resolves.
  claimed: 2,
  disputed: 2,
  arbitrated: 2,
  released: 3,
};

function formatInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** What the deposit is doing right now, said plainly. */
function caption(escrow: EscrowDetail | null, timezone: string): string {
  if (!escrow || escrow.state === "scheduled") {
    return "Scheduled — held at listing-local check-in. Nobody can spend it meanwhile.";
  }
  switch (escrow.state) {
    case "held":
      return escrow.heldAt
        ? `Held since ${formatInZone(escrow.heldAt, timezone)}. Your card has not been charged.`
        : "Held. Your card has not been charged.";
    case "claim_window":
      return escrow.windowClosesAt
        ? `The claim window closes ${formatInZone(escrow.windowClosesAt, timezone)}. It returns on its own if no claim is filed.`
        : "The claim window is open. It returns on its own if no claim is filed.";
    case "claimed":
      return "Your host has filed a claim. You can accept it or send it to independent arbitration.";
    case "disputed":
      return "You disputed the claim. It is with independent arbitration.";
    case "arbitrated":
      return "Independent arbitration has resolved this claim.";
    case "released":
      return escrow.releasedAt
        ? `Returned ${formatInZone(escrow.releasedAt, timezone)}. Nothing was ever taken from your card.`
        : "Returned. Nothing was ever taken from your card.";
    default:
      return "";
  }
}

/**
 * Both props are optional so the pre-booking preview can render the same bar
 * with nothing lit. The timezone only matters once there are real timestamps
 * to format, which is exactly when an escrow exists.
 */
export function EscrowTimeline({
  escrow = null,
  timezone = "UTC",
}: {
  escrow?: EscrowDetail | null;
  timezone?: string;
}) {
  const activeIndex = escrow ? STEP_FOR_STATE[escrow.state] : -1;
  const pct =
    activeIndex <= 0 ? "8%" : `${Math.min(100, (activeIndex / (STEPS.length - 1)) * 100)}%`;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative mt-1">
        <div className="absolute left-[7px] right-[7px] top-1.5 h-0.5 rounded-full bg-[#E4D9C0]" />
        <div
          className="absolute left-[7px] top-1.5 h-0.5 rounded-full bg-brass"
          style={{ width: pct }}
        />
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
                <span
                  className={`text-[10px] ${on ? "font-bold text-ink" : "font-semibold text-ink/50"}`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="m-0 text-xs text-ink/60">{caption(escrow, timezone)}</p>
    </div>
  );
}
