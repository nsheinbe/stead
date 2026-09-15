/**
 * HM-03 — /host/listings/:listingId/scan/status (HM-D04).
 *
 * Tells the host honestly where the scan is and what, if anything, they can
 * do. Every sentence and label is the locked copy; the state is the server's
 * and the page never infers it from time elapsed. No progress bar and no ETA:
 * the worker reports neither. "Check again" refetches once; the page never
 * polls on an interval.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  DataRow,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
  type PillTone,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import {
  HONESTY_REFUSALS,
  SCAN_REASON_COPY,
  SCAN_STATE_COPY,
  SCAN_STATUS_COPY,
  type ScanStateKey,
  type ScanStateTone,
} from "../lib/honestyCopy";
import { formatElapsed } from "../lib/scanCapture";
import type { ListingDetail, ListingScan, ListingScanStatus } from "../lib/types";

export function HostListingScanStatusPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const { user, status } = useAuth();

  const listingQuery = useQuery({
    queryKey: ["listing", listingId],
    enabled: Boolean(listingId) && status === "signed_in",
    queryFn: () => api.listing(listingId as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const listing = listingQuery.data;
  const isOwner = Boolean(listing?.host && user && listing.host.id === user.id);

  const scanQuery = useQuery({
    queryKey: ["listing-scan", listingId],
    enabled: Boolean(listingId) && isOwner,
    queryFn: () => api.listingScan(listingId as string),
    // HM-D04 §4: refetch on focus plus a manual Check again. No interval.
    refetchOnWindowFocus: true,
  });

  const backTo = listingId ? `/host/listings/${listingId}` : "/host/listings";

  if (status !== "signed_in") {
    return (
      <Shell focused width="narrow" workspace="hosting" title="Scan progress" backTo={backTo} backLabel="Edit your home">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to see this scan"
            description="Only the homeowner can see a home's scan. We'll bring you back here."
            intent="homeowner"
          />
        </div>
      </Shell>
    );
  }

  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;

  return (
    <Shell focused width="narrow" workspace="hosting" title="Scan progress" backTo={backTo} backLabel="Edit your home">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        {listingQuery.isPending ? (
          <Loading label="Loading this home" />
        ) : notFound || !listing ? (
          <>
            <PageHeader
              title="We couldn't find this home."
              description="It may have been deleted, or the link may be out of date."
            />
            <ButtonLink to="/host/listings" className="self-start">
              Your homes
            </ButtonLink>
          </>
        ) : listingQuery.isError ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load this home."
            action={
              <Button variant="secondary" size="sm" onClick={() => void listingQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : !isOwner ? (
          <>
            <PageHeader
              title="This home isn't yours."
              description="Only the homeowner can see a home's scan. You can still view it as a guest would."
            />
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/listing/${listing.id}`}>View this home</ButtonLink>
              <ButtonLink to="/host/listings" variant="secondary">
                Your homes
              </ButtonLink>
            </div>
          </>
        ) : scanQuery.isPending ? (
          <Loading label="Checking this home's scan" />
        ) : scanQuery.isError || !scanQuery.data ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load the scan."
            action={
              <Button variant="secondary" size="sm" onClick={() => void scanQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <Progress listing={listing} status={scanQuery.data} refetch={() => scanQuery.refetch()} />
        )}
      </div>
    </Shell>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------

const PILL_TONE: Record<ScanStateTone, PillTone> = { neutral: "neutral", warning: "warning", brand: "brand" };

function stateKeyFor(status: ListingScanStatus): ScanStateKey {
  if (!status.scan) return status.coordinatesConfirmed ? "not_started" : "needs_location";
  return status.scan.state;
}

/** "d MMM yyyy, h:mm a" in the listing's zone, with the zone named (HM-D04 §7). */
function stamp(iso: string, timezone: string): string {
  return `${formatInTimeZone(iso, timezone, "d MMM yyyy, h:mm a")} (${timezone})`;
}

function sentenceFor(key: ScanStateKey, scan: ListingScan | null, timezone: string): string {
  switch (key) {
    case "not_started":
    case "needs_location":
      return SCAN_STATUS_COPY.none;
    case "capturing":
    case "uploading":
      return SCAN_STATUS_COPY.capturing;
    case "uploaded":
      return SCAN_STATUS_COPY.uploaded;
    case "reconstructing":
      return SCAN_STATUS_COPY.reconstructing;
    case "needs_mask":
      return SCAN_STATUS_COPY.needs_mask;
    case "verified":
      return SCAN_STATUS_COPY.verified(
        scan?.verifiedAt ? formatInTimeZone(scan.verifiedAt, timezone, "d MMM yyyy") : "",
      );
    case "rejected":
      return SCAN_STATUS_COPY.rejected;
    case "failed":
      return SCAN_STATUS_COPY.failed;
  }
}

function Progress({
  listing,
  status,
  refetch,
}: {
  listing: ListingDetail;
  status: ListingScanStatus;
  refetch: () => Promise<{ data?: ListingScanStatus }>;
}) {
  const queryClient = useQueryClient();
  const scan = status.scan;
  const key = stateKeyFor(status);
  const entry = SCAN_STATE_COPY[key];
  const label =
    typeof entry.label === "function"
      ? entry.label(scan?.verifiedAt ? formatInTimeZone(scan.verifiedAt, listing.timezone, "d MMM yyyy") : "")
      : entry.label;

  // -- Check again: one refetch, one polite announcement ------------------
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  async function checkAgain() {
    setChecking(true);
    setAnnouncement(null);
    try {
      const result = await refetch();
      const next = result.data?.scan?.state;
      if (next === "needs_mask") setAnnouncement(SCAN_STATUS_COPY.checkAgainReady);
      else if (next === "uploaded" || next === "reconstructing") setAnnouncement(SCAN_STATUS_COPY.checkAgainStill);
    } finally {
      setChecking(false);
    }
  }

  // -- Try processing again: the state comes back from the server ---------
  const [retryError, setRetryError] = useState<string | null>(null);
  const retry = useMutation({
    mutationFn: () => api.retryScan(listing.id, (scan as ListingScan).id),
    onSuccess: (updated) => {
      setRetryError(null);
      queryClient.setQueryData<ListingScanStatus>(["listing-scan", listing.id], (prev) =>
        prev ? { ...prev, scan: updated } : prev,
      );
    },
    onError: (err) => {
      setRetryError(err instanceof ApiError ? err.message : "We couldn't queue that. Try again.");
    },
  });

  const capturePath = `/host/listings/${listing.id}/scan`;
  const wherePath = `/host/listings/${listing.id}#where`;

  const reasonLine = scan?.reason ? SCAN_REASON_COPY[scan.reason] : null;

  return (
    <>
      <PageHeader title={`Scan progress — ${listing.title || "this home"}`} />

      <Card data-testid="scan-status-card">
        <StatusPill tone={PILL_TONE[entry.tone]} testId="scan-status-pill">
          {label}
        </StatusPill>
        <p className="mb-0 mt-3 text-base" data-testid="scan-status-sentence">
          {sentenceFor(key, scan, listing.timezone)}
        </p>
        {(key === "rejected" || key === "failed") && reasonLine ? (
          <p className="mb-0 mt-2 text-sm text-ink-secondary" data-testid="scan-status-reason">
            {reasonLine}
          </p>
        ) : null}
        {key === "needs_mask" ? <p className="mb-0 mt-2 text-sm text-ink-secondary">{SCAN_STATUS_COPY.maskNotYet}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {key === "not_started" ? <ButtonLink to={capturePath}>{entry.action}</ButtonLink> : null}
          {key === "needs_location" ? <ButtonLink to={wherePath}>{entry.action}</ButtonLink> : null}
          {key === "capturing" || key === "uploading" ? <ButtonLink to={capturePath}>{entry.action}</ButtonLink> : null}
          {key === "uploaded" || key === "reconstructing" ? (
            <Button variant="secondary" busy={checking} busyLabel="Checking…" onClick={() => void checkAgain()}>
              Check again
            </Button>
          ) : null}
          {key === "verified" ? (
            <ButtonLink to={`/listing/${listing.id}`} variant="secondary">
              View this home
            </ButtonLink>
          ) : null}
          {key === "rejected" ? (
            <>
              <ButtonLink to={capturePath}>Walk again</ButtonLink>
              {scan?.reason === "location_mismatch" ? (
                <ButtonLink to={wherePath} variant="secondary">
                  Check the home's location
                </ButtonLink>
              ) : null}
            </>
          ) : null}
          {key === "failed" && scan ? (
            <>
              <Button
                busy={retry.isPending}
                busyLabel="Queuing…"
                disabled={!scan.canRetry}
                onClick={() => retry.mutate()}
                data-testid="scan-retry"
              >
                Try processing again
              </Button>
              <ButtonLink to={capturePath} variant="secondary">
                Walk again
              </ButtonLink>
            </>
          ) : null}
        </div>
        {key === "failed" && scan && !scan.canRetry ? (
          <p className="mb-0 mt-3 text-sm text-ink-secondary" data-testid="scan-retry-exhausted">
            {HONESTY_REFUSALS.retryExhausted(scan.attempt)}
          </p>
        ) : null}
        {retryError ? (
          <p role="alert" className="mb-0 mt-3 text-sm text-warning">
            {retryError}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className={announcement ? "mb-0 mt-3 text-sm" : "sr-only"} data-testid="scan-check-result">
          {announcement ?? ""}
        </p>
      </Card>

      {scan ? <Facts scan={scan} timezone={listing.timezone} /> : null}

      {scan && scan.state === "failed" ? <Stills listingId={listing.id} scan={scan} /> : null}

      {scan && scan.state !== "verified" ? (
        <Surface as="section" aria-labelledby="scan-next-heading">
          <h2 id="scan-next-heading" className="m-0 text-base font-semibold">
            What happens next
          </h2>
          <p className="mb-0 mt-2 text-sm text-ink-secondary">{SCAN_STATUS_COPY.whatNext}</p>
        </Surface>
      ) : null}
    </>
  );
}

/** The facts the server holds, stated as facts. Nothing here is a verdict. */
function Facts({ scan, timezone }: { scan: ListingScan; timezone: string }) {
  const locationCheck =
    scan.state === "capturing" ? "Not yet" : scan.state === "rejected" ? "Couldn't confirm" : scan.stats ? "Confirmed" : "Not yet";
  return (
    <Card>
      <DataList>
        <DataRow
          label="Walk recorded"
          value={scan.capturedOn ? format(parseISO(scan.capturedOn), "d MMM yyyy") : "Not yet"}
          hint={scan.capturedOn ? "Date in this home's time zone" : undefined}
        />
        <DataRow label="Walk length" value={scan.stats ? formatElapsed(scan.stats.durationSeconds * 1000) : "Not yet"} />
        <DataRow label="Location check" value={locationCheck} />
        <DataRow label="Processing started" value={scan.claimedAt ? stamp(scan.claimedAt, timezone) : "Not yet"} />
        {scan.attempt > 0 ? (
          <DataRow label="Processing attempts" value={`${scan.attempt} of ${scan.maxAttempts}`} testId="scan-attempts" />
        ) : null}
        <DataRow label="Last update" value={stamp(scan.updatedAt, timezone)} />
      </DataList>
    </Card>
  );
}

/**
 * What the worker saw: real frames from the walk, served through short-lived
 * signed URLs. The caption carries the meaning; the images are decorative.
 */
function Stills({ listingId, scan }: { listingId: string; scan: ListingScan }) {
  const stillsQuery = useQuery({
    queryKey: ["listing-scan-stills", listingId, scan.id, scan.updatedAt],
    enabled: scan.outputs.stills,
    queryFn: () => api.scanStills(listingId, scan.id),
    staleTime: 60_000,
  });
  return (
    <section aria-labelledby="scan-stills-heading" className="flex flex-col gap-3">
      <h2 id="scan-stills-heading" className="m-0 text-base font-semibold">
        What the worker saw
      </h2>
      {!scan.outputs.stills ? (
        <p className="m-0 text-sm text-ink-secondary">{SCAN_STATUS_COPY.stillsNone}</p>
      ) : stillsQuery.isPending ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true">
          <p role="status" className="sr-only">
            Loading frames from the walk
          </p>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full" />
          ))}
        </div>
      ) : stillsQuery.isError || !stillsQuery.data ? (
        <StatusMessage
          tone="danger"
          title="We couldn't load the frames."
          action={
            <Button variant="secondary" size="sm" onClick={() => void stillsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : stillsQuery.data.stills.length === 0 ? (
        <p className="m-0 text-sm text-ink-secondary">{SCAN_STATUS_COPY.stillsNone}</p>
      ) : (
        <figure className="m-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="scan-stills">
            {stillsQuery.data.stills.map((still) => (
              <ListingPhoto key={still.index} src={still.url} alt="" aspect="4/3" className="rounded-surface" />
            ))}
          </div>
          <figcaption className="mt-2 text-sm text-ink-secondary">{SCAN_STATUS_COPY.stillsCaption}</figcaption>
        </figure>
      )}
    </section>
  );
}
