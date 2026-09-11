import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { dollarsToCents } from "../lib/cents";
import { prettyRange } from "../lib/dates";
import { formatUsd } from "../lib/money";
import { CLAIM_STATE_LABEL } from "../lib/types";

export function HostClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>();
  const { user, loading, status } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [splitDollars, setSplitDollars] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");

  const claim = useQuery({
    queryKey: ["claim", claimId],
    enabled: Boolean(user) && Boolean(claimId),
    queryFn: () => api.claim(claimId as string),
    retry: false,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
    await queryClient.invalidateQueries({ queryKey: ["claims"] });
  };

  const respond = useMutation({
    mutationFn: (accept: boolean) => api.respondClaim(claimId as string, accept),
    onSuccess: invalidate,
  });

  const resolve = useMutation({
    mutationFn: (input: { outcome: "host" | "guest" | "split"; amountCents?: number }) =>
      api.resolveClaim(claimId as string, { ...input, note: note || undefined }),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const signed = await api.claimEvidenceUploadUrl(claimId as string, file.type);
      await api.uploadToBucket(signed.uploadUrl, file);
      return api.attachClaimEvidence(claimId as string, signed.key, evidenceNote || undefined);
    },
    onSuccess: async () => {
      setEvidenceNote("");
      await invalidate();
    },
  });

  const data = claim.data;
  const notFound = claim.error instanceof ApiError && claim.error.status === 404;
  const splitCents = dollarsToCents(splitDollars);

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <HostSubnav />
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Claim</h1>
          {data ? (
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                data.state === "guest_disputed" || data.state === "arbitration"
                  ? "bg-claim/10 text-claim"
                  : "bg-linen"
              }`}
            >
              {CLAIM_STATE_LABEL[data.state]}
            </span>
          ) : null}
        </div>

        {loading || claim.isLoading ? <StatusBanner title="Loading this claim…" /> : null}
        {user && notFound ? <StatusBanner title="Claim not found" /> : null}
        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to review this claim"
            description="Only the parties on this stay and an authorized arbiter can open it."
          />
        ) : null}

        {data ? (
          <>
            <div className="flex flex-col gap-1 rounded-card border border-linen-tint px-4 py-3.5">
              <span className="text-sm font-bold">{data.listingTitle}</span>
              <span className="text-xs text-ink/55">
                {prettyRange(data.checkIn, data.checkOut)}
              </span>
              <span className="money mt-2 text-lg font-bold">{formatUsd(data.amountCents)}</span>
              <p className="m-0 mt-2 text-[13px] leading-relaxed text-ink/75">{data.description}</p>
              {data.resolutionNote ? (
                <p className="mb-0 mt-2 text-[12.5px] text-ink/60">{data.resolutionNote}</p>
              ) : null}
              {data.resolutionAmountCents != null ? (
                <p className="money mb-0 mt-1 text-sm font-semibold">
                  Resolved at {formatUsd(data.resolutionAmountCents)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11.5px] font-bold tracking-[0.14em] text-ink/50">EVIDENCE</span>
              {data.evidence.length === 0 ? (
                <StatusBanner title="No photos yet" detail="Parties can attach images while the claim is live." />
              ) : null}
              {data.evidence.map((item) => (
                <div key={item.id} className="overflow-hidden rounded-[12px] border border-linen-tint">
                  <img src={item.storagePath} alt="" className="max-h-64 w-full object-cover" />
                  {item.note ? <p className="m-0 px-3 py-2 text-xs text-ink/60">{item.note}</p> : null}
                </div>
              ))}
              {data.canFileEvidence ? (
                <label className="flex flex-col gap-2 text-xs font-bold text-ink/60">
                  Add a photo
                  <input
                    type="text"
                    value={evidenceNote}
                    onChange={(e) => setEvidenceNote(e.target.value)}
                    placeholder="Optional note"
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                    }}
                  />
                </label>
              ) : null}
              {upload.isError ? (
                <StatusBanner
                  tone="claim"
                  title="Could not attach that photo"
                  detail={upload.error instanceof ApiError ? upload.error.message : undefined}
                />
              ) : null}
            </div>

            {data.canRespond ? (
              <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-dashed border-claim/40 bg-claim/[0.04] p-[18px]">
                <p className="m-0 text-sm">
                  Accept {formatUsd(data.amountCents)} from your deposit, or dispute it for independent
                  arbitration.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => respond.mutate(true)}
                    disabled={respond.isPending}
                    className="rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                  >
                    Accept claim
                  </button>
                  <button
                    type="button"
                    onClick={() => respond.mutate(false)}
                    disabled={respond.isPending}
                    className="rounded-full border border-claim/40 px-4 py-2 text-sm font-bold text-claim disabled:opacity-60"
                  >
                    Dispute
                  </button>
                </div>
                {respond.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not record that"
                    detail={respond.error instanceof ApiError ? respond.error.message : undefined}
                  />
                ) : null}
              </div>
            ) : null}

            {data.canResolve ? (
              <div className="flex flex-col gap-3 rounded-card border-[1.5px] border-dashed border-claim/50 p-[18px]">
                <span className="text-sm font-bold">Independent arbitration</span>
                <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                  NOTE
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ outcome: "host" })}
                    disabled={resolve.isPending}
                    className="rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                  >
                    Host in full
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ outcome: "guest" })}
                    disabled={resolve.isPending}
                    className="rounded-full border border-linen-tint px-4 py-2 text-sm font-bold text-ink/70 disabled:opacity-60"
                  >
                    Guest — release
                  </button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                    SPLIT AMOUNT
                    <input
                      inputMode="decimal"
                      value={splitDollars}
                      onChange={(e) => setSplitDollars(e.target.value)}
                      placeholder="120.00"
                      className="w-32 rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={resolve.isPending || splitCents == null || splitCents < 1}
                    onClick={() => {
                      if (splitCents == null) return;
                      resolve.mutate({ outcome: "split", amountCents: splitCents });
                    }}
                    className="rounded-full bg-claim px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                  >
                    Resolve split
                  </button>
                </div>
                {resolve.isError ? (
                  <StatusBanner
                    tone="claim"
                    title="Could not resolve"
                    detail={resolve.error instanceof ApiError ? resolve.error.message : undefined}
                  />
                ) : null}
              </div>
            ) : null}

            <Link to={`/trips/${data.bookingId}`} className="text-sm font-bold no-underline">
              Open the stay →
            </Link>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
