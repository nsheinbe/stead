import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { HonestySheet } from "../components/honesty/HonestySheet";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { HM } from "../lib/honesty";
import { hubKind, rejectedReasonCopy, revokedReasonCopy, scanStatePill } from "../lib/scanHub";
import { clearScan } from "../lib/scanStore";

/** A coarse pointer is the best signal the browser gives that this is a phone. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/**
 * The scan hub (HM-D01): one card for the current state and one next action.
 * Every state on this page is the server's word — the browser never computes
 * a verdict — and upload, reconstruction and masking are later releases, so
 * a walk that has passed its location check waits here, honestly labelled.
 */
export function HostListingScanPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const phone = usePhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);

  const hub = useQuery({
    queryKey: ["host-scan", listingId],
    enabled: Boolean(listingId) && status === "signed_in",
    queryFn: () => api.hostScan(listingId as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["host-scan", listingId] });

  const start = useMutation({
    mutationFn: () =>
      api.startScan(listingId as string, {
        policyVersion: hub.data?.policyVersion ?? "",
        acknowledged: true,
      }),
    onSuccess: async (result) => {
      await invalidate();
      navigate(`/host/listings/${listingId}/scan/capture?scan=${result.scanId}`);
    },
  });

  const discard = useMutation({
    mutationFn: async (scanId: string) => {
      await api.discardScan(listingId as string, scanId);
      await clearScan(scanId).catch(() => undefined);
    },
    onSuccess: invalidate,
  });

  const openSheet = () => {
    setSheetKey((k) => k + 1);
    start.reset();
    setSheetOpen(true);
  };

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" workspace="hosting" title={HM["hm.hub.title"]}>
        <div className="py-8">
          <SignInPrompt
            title="Sign in to scan this home"
            description="Only the homeowner can scan a listing. We'll bring you back here."
            intent="homeowner"
          />
        </div>
      </Shell>
    );
  }

  const notFound = hub.error instanceof ApiError && hub.error.status === 404;
  const data = hub.data;
  const kind = data ? hubKind(data) : null;
  const pill = data ? scanStatePill(data) : null;
  const scan = data?.scan ?? null;
  const editorHref = `/host/listings/${listingId}`;

  return (
    <Shell
      width="narrow"
      workspace="hosting"
      title={HM["hm.hub.title"]}
      backTo={editorHref}
      backLabel="Edit your home"
    >
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        {hub.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p role="status" className="sr-only">
              Loading this home's honesty scan
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : notFound || !data ? (
          <>
            <PageHeader
              title="We couldn't find this home."
              description="It may have been deleted, or the link may be out of date."
            />
            <ButtonLink to="/host/listings" className="self-start">
              Your homes
            </ButtonLink>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <PageHeader title={HM["hm.hub.title"]} description={data.listing.title || "Untitled home"} />
              <div className="flex flex-wrap items-center gap-2">
                {pill ? <StatusPill tone={pill.tone}>{pill.label}</StatusPill> : null}
                <Link to={editorHref} className="text-sm font-semibold">
                  Edit your home
                </Link>
              </div>
            </div>

            {kind === "needs_pin" ? (
              <Card as="section" aria-labelledby="scan-state">
                <h2 id="scan-state" className="m-0 text-card-title">
                  {HM["hm.scan.state.needsPin"].replace(/^Scan: /, "")}
                </h2>
                <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.pin.required"]}</p>
                <div className="mt-4">
                  <ButtonLink to={`${editorHref}#where-heading`}>{HM["hm.scan.next.pin"]}</ButtonLink>
                </div>
              </Card>
            ) : null}

            {kind === "not_started" || kind === "rejected" || kind === "revoked" || kind === "located" ? (
              <Card as="section" aria-labelledby="scan-state">
                {kind === "not_started" ? (
                  <>
                    <h2 id="scan-state" className="m-0 text-card-title">
                      {HM["hm.hub.notStarted.title"]}
                    </h2>
                    <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.hub.notStarted.body"]}</p>
                  </>
                ) : null}
                {kind === "rejected" && scan ? (
                  <>
                    <h2 id="scan-state" className="m-0 text-card-title">
                      {HM["hm.rejected.title"]}
                    </h2>
                    <p className="mb-0 mt-2 text-ink-secondary">{rejectedReasonCopy(scan.rejectReason)}</p>
                  </>
                ) : null}
                {kind === "revoked" && scan ? (
                  <>
                    <h2 id="scan-state" className="m-0 text-card-title">
                      {HM["hm.revoked.title"]}
                    </h2>
                    <p className="mb-0 mt-2 text-ink-secondary">
                      {HM["hm.revoked.body"]
                        .replace("{date}", scan.revokedAt ? new Date(scan.revokedAt).toLocaleDateString() : "")
                        .replace("{reason}", revokedReasonCopy(scan.revokedReason))}
                    </p>
                  </>
                ) : null}
                {kind === "located" ? (
                  <>
                    <h2 id="scan-state" className="m-0 text-card-title">
                      {HM["hm.hub.located.title"]}
                    </h2>
                    <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.hub.located.body"]}</p>
                  </>
                ) : null}

                {phone ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button onClick={openSheet} variant={kind === "located" ? "secondary" : "primary"}>
                      {kind === "not_started" ? HM["hm.hub.start"] : HM["hm.rejected.again"]}
                    </Button>
                    {kind === "rejected" ? (
                      <ButtonLink to={`${editorHref}#where-heading`} variant="secondary">
                        {HM["hm.rejected.checkPin"]}
                      </ButtonLink>
                    ) : null}
                  </div>
                ) : (
                  <Surface padding="sm" className="mt-4">
                    <h3 className="m-0 text-base font-semibold">{HM["hm.hub.desktop.title"]}</h3>
                    <p className="mb-0 mt-2 text-sm text-ink-secondary">{HM["hm.hub.desktop.body"]}</p>
                    {kind === "rejected" ? (
                      <div className="mt-3">
                        <ButtonLink to={`${editorHref}#where-heading`} variant="secondary" size="sm">
                          {HM["hm.rejected.checkPin"]}
                        </ButtonLink>
                      </div>
                    ) : null}
                  </Surface>
                )}
              </Card>
            ) : null}

            {kind === "in_progress" && scan ? (
              <Card as="section" aria-labelledby="scan-state">
                <h2 id="scan-state" className="m-0 text-card-title">
                  {HM["hm.hub.inProgress.title"]}
                </h2>
                <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.hub.inProgress.body"]}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {phone ? (
                    <ButtonLink to={`/host/listings/${listingId}/scan/capture?scan=${scan.id}`}>
                      {HM["hm.scan.next.continue"]}
                    </ButtonLink>
                  ) : null}
                  <Button
                    variant="danger"
                    busy={discard.isPending}
                    busyLabel="Deleting…"
                    onClick={() => discard.mutate(scan.id)}
                  >
                    {HM["hm.hub.discard"]}
                  </Button>
                </div>
                {discard.isError ? (
                  <div className="mt-3">
                    <StatusMessage tone="danger" title="We couldn't delete that walk. Please try again." />
                  </div>
                ) : null}
              </Card>
            ) : null}

            {kind === "later" && scan ? (
              <Card as="section" aria-labelledby="scan-state">
                <h2 id="scan-state" className="m-0 text-card-title">
                  {pill?.label.replace(/^Scan: /, "")}
                </h2>
              </Card>
            ) : null}

            <Surface padding="sm">
              <p className="m-0 text-sm text-ink-secondary">{HM["hm.hub.facts"]}</p>
            </Surface>

            <HonestySheet
              key={sheetKey}
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              onStart={() => start.mutate()}
              starting={start.isPending}
              error={
                start.isError
                  ? start.error instanceof ApiError
                    ? start.error.message
                    : HM["hm.sheet.failed"]
                  : null
              }
            />
          </>
        )}
        {hub.isError && !notFound ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load this home's honesty scan."
            action={
              <Button variant="secondary" size="sm" onClick={() => void hub.refetch()}>
                Try again
              </Button>
            }
          />
        ) : null}
      </div>
    </Shell>
  );
}
