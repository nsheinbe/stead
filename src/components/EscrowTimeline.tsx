import type { DepositMethod, EscrowDetail, EscrowState } from "../lib/types";

/**
 * The deposit's actual history, from escrow_audit.
 *
 * Every step shown is one the server recorded, with the timestamp it
 * recorded. Nothing is projected forward: a scheduled deposit shows one
 * pending line, not a completed one, and no countdown is invented from a
 * database row. Rendered as an ordered list so the sequence is programmatic,
 * with the state in text rather than colour alone.
 */
const STATE_LABEL: Record<EscrowState, string> = {
  scheduled: "Scheduled",
  held: "Held",
  claim_window: "Claim window open",
  claimed: "Claim filed",
  disputed: "Claim disputed",
  arbitrated: "Arbitration resolved",
  released: "Released",
};

function formatInZone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

/** What the deposit is doing right now, said without overclaiming. */
function caption(escrow: EscrowDetail, timezone: string): string {
  switch (escrow.state) {
    case "scheduled":
      return escrow.method === "auth_hold"
        ? "Nothing has been authorized yet. This happens near check-in."
        : "Nothing has been charged. Your card stays on file for the deposit arrangement.";
    case "held":
      return escrow.heldAt
        ? `Recorded as held on ${formatInZone(escrow.heldAt, timezone)}.`
        : "Recorded as held.";
    case "claim_window":
      return escrow.windowClosesAt
        ? `Your host can raise a claim until ${formatInZone(escrow.windowClosesAt, timezone)}.`
        : "The claim window is open.";
    case "claimed":
      return "Your host has raised a claim. You can accept it or record a dispute.";
    case "disputed":
      return "You recorded a dispute. The claim is with arbitration.";
    case "arbitrated":
      return "Arbitration has resolved this claim.";
    case "released":
      return escrow.releasedAt
        ? `Released on ${formatInZone(escrow.releasedAt, timezone)}.`
        : "Released.";
    default:
      return "";
  }
}

export function EscrowTimeline({
  escrow,
  timezone = "UTC",
}: {
  escrow: EscrowDetail;
  timezone?: string;
}) {
  const steps = escrow.timeline;

  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 ? (
        <p className="m-0 text-sm text-ink-secondary">No deposit update is available yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {steps.map((step, index) => (
            <li key={`${step.toState}-${step.at}`} className="flex gap-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                  index === steps.length - 1 ? "bg-brand" : "bg-control"
                }`}
              />
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold">{STATE_LABEL[step.toState]}</p>
                <p className="m-0 text-sm text-ink-secondary">{formatInZone(step.at, timezone)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="m-0 text-sm text-ink-secondary">{caption(escrow, timezone)}</p>
    </div>
  );
}

/**
 * Pre-booking explanation of what will happen, stated as a sequence rather
 * than a progress bar — nothing has happened yet, so nothing is lit.
 */
export function DepositSequence({ method }: { method: DepositMethod }) {
  const steps =
    method === "auth_hold"
      ? [
          "Near check-in, your card is authorized for the deposit amount.",
          "After checkout, your host has a limited window to raise a claim.",
          "With no claim, the authorization is released.",
        ]
      : [
          "Nothing is collected for the deposit when you pay for your stay.",
          "After checkout, your host has a limited window to raise a claim.",
          "If you accept a claim, the agreed amount can be charged to the card on file.",
        ];
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-ink-secondary">
      {steps.map((step, index) => (
        <li key={step} className="flex gap-2.5">
          <span className="money shrink-0 font-semibold text-ink">{index + 1}.</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
