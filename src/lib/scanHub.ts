/**
 * What the scan hub shows for a given server state (HM-01, HM-02). Pure, so
 * the mapping from the server's words to the host's card is testable without
 * a browser. Nothing here infers a verdict: `located` is only ever the
 * server's `geofence = passed`, and `queued` only ever the server's
 * `state = uploaded`.
 */
import { HM } from "./honesty";
import type { PillTone } from "../components/ui/StatusPill";
import type { HostScan, ScanState } from "./types";

export type HubKind =
  | "needs_pin"
  | "not_started"
  | "in_progress"
  | "located"
  | "queued"
  | "rejected"
  | "revoked"
  | "later";

export function hubKind(hub: HostScan): HubKind {
  const scan = hub.scan;
  if (!scan) return hub.listing.hasPin ? "not_started" : "needs_pin";
  if (scan.state === "capturing") {
    if (scan.geofence === "passed") return "located";
    if (scan.geofence === "pending") return hub.listing.hasPin ? "in_progress" : "needs_pin";
  }
  if (scan.state === "uploaded") return "queued";
  if (scan.state === "rejected") return "rejected";
  if (scan.state === "revoked") return "revoked";
  // reconstructing, needs_mask, verified, failed: HM-03 onward.
  return "later";
}

const STATE_LABEL: Record<ScanState, string> = {
  capturing: HM["hm.scan.state.capturing"],
  uploaded: HM["hm.scan.state.queued"],
  reconstructing: HM["hm.scan.state.building"],
  needs_mask: HM["hm.scan.state.needsMask"],
  verified: HM["hm.scan.state.verified"],
  rejected: HM["hm.scan.state.rejected"],
  failed: HM["hm.scan.state.failed"],
  revoked: HM["hm.scan.state.revoked"],
};

/** The pill: text is the state, colour only reinforces. Never danger. */
export function scanStatePill(hub: HostScan): { label: string; tone: PillTone } {
  const kind = hubKind(hub);
  switch (kind) {
    case "needs_pin":
      return { label: HM["hm.scan.state.needsPin"], tone: "neutral" };
    case "not_started":
      return { label: HM["hm.scan.state.notStarted"], tone: "neutral" };
    case "located":
      return { label: HM["hm.scan.state.located"], tone: "neutral" };
    case "rejected":
    case "revoked":
      return { label: STATE_LABEL[hub.scan!.state], tone: "warning" };
    default:
      return {
        label: STATE_LABEL[hub.scan!.state],
        tone: hub.scan!.state === "verified" ? "brand" : "neutral",
      };
  }
}

/** The host-facing sentence for a refused walk. */
export function rejectedReasonCopy(reason: HostScan["scan"] extends infer S ? (S extends { rejectReason: infer R } ? R : never) : never): string {
  switch (reason) {
    case "geofence":
      return HM["hm.rejected.geofence"];
    case "samples":
      return HM["hm.rejected.samples"];
    case "accuracy":
      return HM["hm.rejected.accuracy"];
    case "bookends":
      return HM["hm.rejected.bookends"];
    default:
      return HM["hm.rejected.title"];
  }
}

/** The sentence fragment inside `hm.revoked.body` for a known reason. */
export function revokedReasonCopy(reason: string | null): string {
  if (reason === "pin_changed") return HM["hm.revoked.reason.pinChanged"];
  return reason ?? "it was taken down";
}
