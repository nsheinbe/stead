import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  DataRow,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
  Textarea,
  TextInput,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { dollarsToCents } from "../lib/cents";
import { prettyRange } from "../lib/dates";
import { formatUsd } from "../lib/money";
import { CLAIM_STATE_LABEL, type ClaimDetail } from "../lib/types";

/**
 * A decision that moves money, held until it is confirmed.
 *
 * Every action on this page is irreversible and charges or releases a real
 * amount, so none of them happen on a first click. The confirmation names the
 * exact figure and who receives it — the number is the thing being agreed to,
 * not a detail of it.
 */
type PendingAction =
  | { kind: "accept"; amountCents: number }
  | { kind: "dispute" }
  | { kind: "resolve-host"; amountCents: number }
  | { kind: "resolve-guest" }
  | { kind: "resolve-split"; amountCents: number };

function confirmCopy(action: PendingAction, claim: ClaimDetail): { title: string; body: string; cta: string } {
  switch (action.kind) {
    case "accept":
      return {
        title: `Accept this claim for ${formatUsd(action.amountCents)}?`,
        body: `${formatUsd(action.amountCents)} will be charged to the card you have on file for this stay and paid to the host. This cannot be undone, and the claim closes.`,
        cta: `Accept and pay ${formatUsd(action.amountCents)}`,
      };
    case "dispute":
      return {
        title: "Dispute this claim?",
        body: `Nothing is charged now. The claim goes to an independent arbiter, who decides how much of the ${formatUsd(claim.amountCents)} the host receives. You cannot withdraw a dispute.`,
        cta: "Send to arbitration",
      };
    case "resolve-host":
      return {
        title: `Resolve in the host's favour for ${formatUsd(action.amountCents)}?`,
        body: `The full claim of ${formatUsd(action.amountCents)} will be charged to the guest's card on file and paid to the host. This closes the claim and cannot be undone.`,
        cta: `Charge ${formatUsd(action.amountCents)} to the guest`,
      };
    case "resolve-guest":
      return {
        title: "Resolve in the guest's favour?",
        body: "Nothing is charged. The deposit is released in full and the claim closes. This cannot be undone.",
        cta: "Release the deposit",
      };
    case "resolve-split":
      return {
        title: `Resolve this claim at ${formatUsd(action.amountCents)}?`,
        body: `${formatUsd(action.amountCents)} of the ${formatUsd(claim.amountCents)} claimed will be charged to the guest's card on file and paid to the host. The rest is released. This closes the claim and cannot be undone.`,
        cta: `Charge ${formatUsd(action.amountCents)} and close`,
      };
  }
}

export function HostClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [splitDollars, setSplitDollars] = useState("");
  const [splitError, setSplitError] = useState<string | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);

  const claim = useQuery({
    queryKey: ["claim", claimId],
    enabled: Boolean(user) && Boolean(claimId),
    queryFn: () => api.claim(claimId as string),
    retry: false,
  });

  const invalidate = async () => {
    setPending(null);
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

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" workspace="hosting" title="Claim">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to review this claim"
            description="Only the two people on this stay and an authorized arbiter can open it."
          />
        </div>
      </Shell>
    );
  }

  if (claim.isPending) {
    return (
      <Shell width="narrow" workspace="hosting" title="Claim">
        <div className="flex flex-1 flex-col gap-4 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this claim
          </p>
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell width="narrow" workspace="hosting" title="Claim">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="We couldn't find this claim."
            description="It may not be yours to see, or the link may be out of date."
          />
          <ButtonLink to="/host/claims" className="self-start">
            All claims
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const closed = data.resolvedAt !== null;
  const splitCents = dollarsToCents(splitDollars);

  function runPending() {
    if (!pending) return;
    switch (pending.kind) {
      case "accept":
        return respond.mutate(true);
      case "dispute":
        return respond.mutate(false);
      case "resolve-host":
        return resolve.mutate({ outcome: "host" });
      case "resolve-guest":
        return resolve.mutate({ outcome: "guest" });
      case "resolve-split":
        return resolve.mutate({ outcome: "split", amountCents: pending.amountCents });
    }
  }

  const acting = respond.isPending || resolve.isPending;
  const actionError = respond.error ?? resolve.error;

  return (
    <Shell width="narrow" workspace="hosting" title="Claim" backTo="/host/claims" backLabel="All claims">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            title={`Claim on ${data.listingTitle}`}
            description={prettyRange(data.checkIn, data.checkOut)}
          />
          <StatusPill tone={data.state === "open" || data.state === "guest_disputed" ? "danger" : "neutral"}>
            {CLAIM_STATE_LABEL[data.state]}
          </StatusPill>
        </div>

        {/* An open card dispute freezes every transition below. Saying so is
            the difference between an explained wait and a silent failure. */}
        {data.chargebackOpen ? (
          <StatusMessage tone="warning" title="This booking has an open card dispute.">
            <p>
              While the cardholder's bank is reviewing that dispute, nothing on this claim can move — not
              accepting it, not disputing it, not resolving it. The claim reopens for action once the bank
              closes its case.
            </p>
          </StatusMessage>
        ) : null}

        <Card>
          <DataList>
            <DataRow label="Amount claimed" value={formatUsd(data.amountCents)} />
            {/* `app.file_claim` is host-only, so the filer is always the host. */}
            <DataRow label="Filed by" value="The host of this home" />
            <DataRow label="You are" value={data.viewerRole === "arbiter" ? "the arbiter" : `the ${data.viewerRole}`} />
            {data.resolutionAmountCents != null ? (
              <DataRow label="Resolved at" value={formatUsd(data.resolutionAmountCents)} />
            ) : null}
          </DataList>
          <div className="mt-4 border-t border-divider pt-4">
            <h2 className="m-0 text-base font-semibold">What the host says happened</h2>
            <p className="mb-0 mt-2 max-w-reading whitespace-pre-line text-ink-secondary">
              {data.description}
            </p>
          </div>
          {data.resolutionNote ? (
            <div className="mt-4 border-t border-divider pt-4">
              <h2 className="m-0 text-base font-semibold">The arbiter's note</h2>
              <p className="mb-0 mt-2 max-w-reading whitespace-pre-line text-ink-secondary">
                {data.resolutionNote}
              </p>
            </div>
          ) : null}
        </Card>

        {/* --- evidence --------------------------------------------- */}
        <section aria-labelledby="evidence-heading" className="flex flex-col gap-4">
          <h2 id="evidence-heading" className="m-0 text-card-title">
            Evidence
          </h2>

          {data.evidence.length === 0 ? (
            <EmptyState title="No photos have been attached.">
              <p>Either side can attach images while the claim is live.</p>
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {data.evidence.map((item, index) => (
                <li key={item.id}>
                  <Card padding="sm">
                    <img
                      src={item.storagePath}
                      alt={`Evidence photo ${index + 1}`}
                      loading="lazy"
                      className="w-full rounded-card object-cover"
                    />
                    {item.note ? (
                      <p className="mb-0 mt-3 text-sm text-ink-secondary">{item.note}</p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {data.canFileEvidence ? (
            <Card padding="sm">
              <h3 className="m-0 text-base font-semibold">Add a photo</h3>
              <p className="m-0 mt-2 text-sm text-ink-secondary">
                Both sides and the arbiter can see anything you attach here.
              </p>
              <div className="mt-4 flex flex-col gap-5">
                <TextInput
                  id="evidence-note"
                  label="Note"
                  optional
                  hint="What this photo shows."
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                />
                <div className="flex flex-col gap-2">
                  <label htmlFor="evidence-file" className="text-sm font-semibold text-ink">
                    Photo
                  </label>
                  <input
                    id="evidence-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    disabled={upload.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                    }}
                    className="text-sm"
                  />
                </div>
                {upload.isPending ? <StatusMessage tone="info" title="Uploading your photo…" /> : null}
                {upload.isError ? (
                  <StatusMessage
                    tone="danger"
                    title={
                      upload.error instanceof ApiError
                        ? upload.error.message
                        : "We couldn't attach that photo. Please try again."
                    }
                  />
                ) : null}
              </div>
            </Card>
          ) : null}
        </section>

        {/* --- the guest's decision --------------------------------- */}
        {data.canRespond ? (
          <section aria-labelledby="respond-heading" className="flex flex-col gap-4">
            <h2 id="respond-heading" className="m-0 text-card-title">
              Your decision
            </h2>
            <Card>
              <p className="m-0 max-w-reading text-ink-secondary">
                Accepting charges {formatUsd(data.amountCents)} to the card on file for this stay and pays
                it to the host. Disputing charges nothing now and sends the claim to an independent
                arbiter. Either way the claim closes to you afterwards.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  onClick={() => setPending({ kind: "accept", amountCents: data.amountCents })}
                >
                  Accept {formatUsd(data.amountCents)}
                </Button>
                <Button variant="danger" onClick={() => setPending({ kind: "dispute" })}>
                  Dispute this claim
                </Button>
              </div>
            </Card>
          </section>
        ) : null}

        {/* --- the arbiter's decision ------------------------------- */}
        {data.canResolve ? (
          <section aria-labelledby="resolve-heading" className="flex flex-col gap-4">
            <h2 id="resolve-heading" className="m-0 text-card-title">
              Arbitration
            </h2>
            <Card>
              <p className="m-0 max-w-reading text-ink-secondary">
                {formatUsd(data.amountCents)} is claimed. Whatever you decide is charged to the guest's
                card on file and paid to the host; the remainder is released. A resolution closes the
                claim and cannot be reversed here.
              </p>

              <div className="mt-5 flex flex-col gap-5">
                <Textarea
                  id="arbiter-note"
                  label="Your note"
                  optional
                  hint="Both sides see this on the claim."
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => setPending({ kind: "resolve-host", amountCents: data.amountCents })}
                  >
                    Award the host {formatUsd(data.amountCents)}
                  </Button>
                  <Button variant="secondary" onClick={() => setPending({ kind: "resolve-guest" })}>
                    Award the guest — release in full
                  </Button>
                </div>

                <div className="border-t border-divider pt-5">
                  <TextInput
                    id="split-amount"
                    label="Or split it"
                    hint={`In US dollars, up to the ${formatUsd(data.amountCents)} claimed.`}
                    inputMode="decimal"
                    className="money"
                    value={splitDollars}
                    error={splitError}
                    onChange={(e) => {
                      setSplitDollars(e.target.value);
                      setSplitError(null);
                    }}
                  />
                  <div className="mt-4">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (splitCents == null || splitCents < 1) {
                          setSplitError("Enter an amount in dollars, such as 120 or 120.50.");
                          return;
                        }
                        if (splitCents > data.amountCents) {
                          setSplitError(
                            `A split cannot exceed the ${formatUsd(data.amountCents)} claimed.`,
                          );
                          return;
                        }
                        setSplitError(null);
                        setPending({ kind: "resolve-split", amountCents: splitCents });
                      }}
                    >
                      Review this split
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </section>
        ) : null}

        {/* Why an action is absent, when absence would otherwise read as a bug. */}
        {closed ? (
          <StatusMessage tone="info" live={false} title="This claim is closed.">
            <p>Nothing further can be done here. The outcome above is what the server recorded.</p>
          </StatusMessage>
        ) : !data.canRespond && !data.canResolve && !data.chargebackOpen ? (
          <Surface padding="sm">
            <p className="m-0 text-sm text-ink-secondary">
              {data.viewerRole === "host"
                ? "You filed this claim. The next move is the guest's — they can accept it or dispute it."
                : data.viewerRole === "guest"
                  ? "You've already responded. The claim is with an arbiter now."
                  : "There's nothing for you to decide on this claim at its current state."}
            </p>
          </Surface>
        ) : null}

        {actionError ? (
          <StatusMessage
            tone="danger"
            title={
              actionError instanceof ApiError
                ? actionError.message
                : "We couldn't record that. Nothing has changed."
            }
          >
            <p>No money moved. You can try again.</p>
          </StatusMessage>
        ) : null}

        <div>
          <ButtonLink to={`/trips/${data.bookingId}`} variant="secondary">
            Open the stay
          </ButtonLink>
        </div>

        <Dialog
          open={pending !== null}
          onClose={() => setPending(null)}
          title={pending ? confirmCopy(pending, data).title : ""}
          size="sm"
        >
          {pending ? (
            <>
              <p className="m-0 text-ink-secondary">{confirmCopy(pending, data).body}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  busy={acting}
                  busyLabel="Recording your decision…"
                  onClick={runPending}
                >
                  {confirmCopy(pending, data).cta}
                </Button>
                <Button variant="secondary" disabled={acting} onClick={() => setPending(null)}>
                  Go back
                </Button>
              </div>
            </>
          ) : null}
        </Dialog>
      </div>
    </Shell>
  );
}
