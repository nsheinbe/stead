import { StatusMessage } from "./ui/Status";

/**
 * Transitional wrapper over StatusMessage for screens that have not been
 * migrated yet. `linen` → info, `claim` → danger. New code should use
 * StatusMessage directly; each screen ticket removes its StatusBanner uses.
 */
export function StatusBanner({
  title,
  detail,
  tone = "linen",
}: {
  title: string;
  detail?: string;
  tone?: "linen" | "claim";
}) {
  return (
    <StatusMessage tone={tone === "claim" ? "danger" : "info"} title={title}>
      {detail ? <p>{detail}</p> : null}
    </StatusMessage>
  );
}
