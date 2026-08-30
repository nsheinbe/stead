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
    <div
      role="status"
      className={`rounded-card px-4 py-4 ${
        tone === "claim" ? "bg-claim/10 text-claim" : "bg-linen text-ink"
      }`}
    >
      <p className="m-0 text-sm font-bold">{title}</p>
      {detail ? <p className="mb-0 mt-1 text-sm text-ink/60">{detail}</p> : null}
    </div>
  );
}
