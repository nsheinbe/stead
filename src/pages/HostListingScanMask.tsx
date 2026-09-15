/**
 * HM-04 — /host/listings/:listingId/scan/mask (HM-D05).
 *
 * The host decides what guests may walk through, as a recorded action, before
 * the walkthrough is verified. Two answers, never both: mark private stretches
 * of the walk, or confirm the whole walk is the rental. A marked stretch is
 * *cut* — the worker drops those frames before it builds anything, so a
 * private room is absent rather than hidden. Nothing here blurs, tidies or
 * fills in, and there is no preview-as-guest before verification.
 *
 * The timeline is the phone path and the only path built (see HM-D05 §10);
 * the desktop 3D crop panel waits for the viewer.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  PageHeader,
  Skeleton,
  StatusMessage,
  Surface,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { HONESTY_REFUSALS, MASK_COPY } from "../lib/honestyCopy";
import {
  coversWholeWalk,
  formatMoment,
  formatRange,
  mergeSegments,
  MAX_MASK_SEGMENTS,
  MIN_SEGMENT_MS,
  stillIndexAt,
  totalMaskedMs,
} from "../lib/scanMask";
import type { ListingDetail, ListingScan, ListingScanStatus, MaskSegment, ScanStills } from "../lib/types";

export function HostListingScanMaskPage() {
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
  });

  const backTo = listingId ? `/host/listings/${listingId}/scan/status` : "/host/listings";

  if (status !== "signed_in") {
    return (
      <Shell focused width="narrow" workspace="hosting" title="Mark private rooms" backTo={backTo} backLabel="Scan progress">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to mark this walk"
            description="Only the homeowner can decide what guests walk through. We'll bring you back here."
            intent="homeowner"
          />
        </div>
      </Shell>
    );
  }

  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;
  const scan = scanQuery.data?.scan ?? null;

  return (
    <Shell focused width="narrow" workspace="hosting" title="Mark private rooms" backTo={backTo} backLabel="Scan progress">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        {listingQuery.isPending ? (
          <Loading />
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
              description="Only the homeowner can decide what guests walk through."
            />
            <ButtonLink to="/host/listings" variant="secondary" className="self-start">
              Your homes
            </ButtonLink>
          </>
        ) : scanQuery.isPending ? (
          <Loading />
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
        ) : !scan || scan.state !== "needs_mask" ? (
          <>
            <PageHeader title={`Mark private rooms — ${listing.title || "this home"}`} />
            <StatusMessage tone="warning" live={false} title={HONESTY_REFUSALS.maskNotReady} testId="mask-not-ready">
              <p>You'll be able to mark private rooms once the walkthrough is built.</p>
            </StatusMessage>
            <ButtonLink to={`/host/listings/${listing.id}/scan/status`} className="self-start">
              Check progress
            </ButtonLink>
          </>
        ) : (
          <Mask listing={listing} scan={scan} />
        )}
      </div>
    </Shell>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" className="sr-only">
        Loading your walk
      </p>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="aspect-[4/3] w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Mask({ listing, scan }: { listing: ListingDetail; scan: ListingScan }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const stillsQuery = useQuery({
    queryKey: ["listing-scan-stills", listing.id, scan.id, scan.updatedAt],
    enabled: scan.outputs.stills,
    queryFn: () => api.scanStills(listing.id, scan.id),
    staleTime: 60_000,
  });

  const durationMs = Math.round((scan.stats?.durationSeconds ?? 0) * 1000);
  const stills: ScanStills["stills"] = stillsQuery.data?.stills ?? [];

  // -- the host's answer, edited locally until saved --------------------
  const [segments, setSegments] = useState<MaskSegment[]>(scan.mask?.segments ?? []);
  const [wholeHome, setWholeHome] = useState(Boolean(scan.mask?.wholeHomeConfirmedAt));
  const [atMs, setAtMs] = useState(0);
  const [markFrom, setMarkFrom] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalMs = totalMaskedMs(segments);
  const frameIndex = stillIndexAt(atMs, stills.length, durationMs);
  const frame = stills[frameIndex];

  const answered = wholeHome || segments.length > 0;
  const allPrivate = !wholeHome && coversWholeWalk(segments, durationMs);

  const summary = useMemo(() => {
    if (wholeHome) return MASK_COPY.summaryWhole;
    if (segments.length === 0) return MASK_COPY.summaryNone;
    return MASK_COPY.summarySegments(segments.length, Math.round(totalMs / 1000));
  }, [wholeHome, segments.length, totalMs]);

  function addSegment(toMs: number) {
    if (markFrom === null) return;
    const from = Math.min(markFrom, toMs);
    const to = Math.max(markFrom, toMs);
    setMarkFrom(null);
    if (to - from < MIN_SEGMENT_MS) {
      setError("That mark is too short to cover a frame. Move further along the walk.");
      return;
    }
    if (segments.length >= MAX_MASK_SEGMENTS) {
      setError(`That's as many private parts as we can record (${MAX_MASK_SEGMENTS}).`);
      return;
    }
    setError(null);
    setSegments((prev) => mergeSegments([...prev, { fromMs: from, toMs: to }], durationMs));
  }

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.saveScanMask>[2]) => api.saveScanMask(listing.id, scan.id, body),
    onSuccess: (mask) => {
      setError(null);
      setNotice(MASK_COPY.saved);
      queryClient.setQueryData<ListingScanStatus>(["listing-scan", listing.id], (prev) =>
        prev && prev.scan ? { ...prev, scan: { ...prev.scan, mask } } : prev,
      );
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "We couldn't save that. Try again."),
  });

  const send = useMutation({
    mutationFn: async () => {
      await api.saveScanMask(listing.id, scan.id, wholeHome ? { wholeHomeConfirmed: true } : { segments });
      return api.sendScanForVerification(listing.id, scan.id);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ListingScanStatus>(["listing-scan", listing.id], (prev) =>
        prev ? { ...prev, scan: updated } : prev,
      );
      navigate(`/host/listings/${listing.id}/scan/status`, { state: { sent: true } });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "We couldn't send that. Try again."),
  });

  const busy = save.isPending || send.isPending;

  return (
    <>
      <PageHeader title={`Mark private rooms — ${listing.title || "this home"}`} />

      <Surface as="section">
        <p className="m-0 text-sm leading-relaxed">{MASK_COPY.intro}</p>
      </Surface>

      {/* -- the walk -------------------------------------------------- */}
      <section aria-labelledby="mask-walk-heading" className="flex flex-col gap-3">
        <h2 id="mask-walk-heading" className="m-0 text-base font-semibold">
          {MASK_COPY.timelineHeading}
        </h2>
        {!scan.outputs.stills ? (
          <StatusMessage tone="warning" live={false} title="We don't have frames from this walk to show.">
            <p>You can still confirm the whole walk is the rental, or walk again.</p>
          </StatusMessage>
        ) : stillsQuery.isPending ? (
          <Skeleton className="aspect-[4/3] w-full" />
        ) : stillsQuery.isError ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load the frames."
            action={
              <Button variant="secondary" size="sm" onClick={() => void stillsQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <ListingPhoto src={frame?.url ?? null} alt="" aspect="4/3" className="rounded-surface" />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{MASK_COPY.scrubberLabel}</span>
              <input
                type="range"
                min={0}
                max={Math.max(durationMs, 1)}
                step={500}
                value={atMs}
                disabled={wholeHome}
                aria-valuetext={formatMoment(atMs)}
                onChange={(e) => setAtMs(Number(e.currentTarget.value))}
                data-testid="mask-scrubber"
              />
              <span className="money text-ink-secondary" data-testid="mask-position">
                {formatMoment(atMs)} of {formatMoment(durationMs)}
              </span>
            </label>
            <p className="m-0 text-sm text-ink-secondary">{MASK_COPY.timelineHint}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={wholeHome}
                onClick={() => {
                  setError(null);
                  setMarkFrom(atMs);
                }}
                data-testid="mask-from"
              >
                {MASK_COPY.markFrom}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={wholeHome || markFrom === null}
                onClick={() => addSegment(atMs)}
                data-testid="mask-to"
              >
                {MASK_COPY.markTo}
              </Button>
            </div>
            {markFrom !== null ? (
              <p role="status" className="m-0 text-sm" data-testid="mask-pending">
                Marking private from {formatMoment(markFrom)}. Move along the walk, then tap {MASK_COPY.markTo}
              </p>
            ) : null}
          </>
        )}

        {segments.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="mask-segments">
            {segments.map((segment) => (
              <li
                key={`${segment.fromMs}-${segment.toMs}`}
                className="flex items-center justify-between gap-3 rounded-surface bg-surface px-3 py-2 text-sm"
              >
                <span className="money">{MASK_COPY.segmentRow(formatRange(segment))}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSegments((prev) => prev.filter((s) => s !== segment))}
                  aria-label={`${MASK_COPY.remove} ${formatRange(segment)}`}
                >
                  {MASK_COPY.remove}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* -- whole home ------------------------------------------------ */}
      <section aria-labelledby="mask-whole-heading" className="flex flex-col gap-2">
        <h2 id="mask-whole-heading" className="m-0 text-base font-semibold">
          {MASK_COPY.wholeHomeHeading}
        </h2>
        {scan.wholeHomeAllowed ? (
          <>
            <Checkbox
              label={MASK_COPY.wholeHomeLabel}
              checked={wholeHome}
              disabled={segments.length > 0}
              onChange={(e) => {
                setError(null);
                setMarkFrom(null);
                setWholeHome(e.currentTarget.checked);
              }}
              data-testid="mask-whole-home"
            />
            {wholeHome ? <p className="m-0 text-sm text-ink-secondary">{MASK_COPY.wholeHomeLocks}</p> : null}
            {segments.length > 0 ? (
              <p className="m-0 text-sm text-ink-secondary">
                Remove the private parts below to confirm the whole walk instead.
              </p>
            ) : null}
          </>
        ) : (
          <p className="m-0 text-sm text-ink-secondary" data-testid="mask-private-room">
            {MASK_COPY.privateRoomHint}
          </p>
        )}
      </section>

      {/* -- summary and the two actions ------------------------------- */}
      <Card data-testid="mask-summary-card">
        <h2 className="m-0 text-base font-semibold">{MASK_COPY.summaryHeading}</h2>
        <p className="mb-0 mt-2 text-sm" data-testid="mask-summary">
          {summary}
        </p>
        {allPrivate ? (
          <p role="alert" className="mb-0 mt-2 text-sm text-warning" data-testid="mask-all-private">
            {HONESTY_REFUSALS.maskAllPrivate}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            busy={send.isPending}
            busyLabel={MASK_COPY.sending}
            disabled={!answered || allPrivate || busy}
            onClick={() => send.mutate()}
            data-testid="mask-send"
          >
            {MASK_COPY.send}
          </Button>
          <Button
            variant="secondary"
            busy={save.isPending}
            busyLabel="Saving…"
            disabled={busy}
            onClick={() => save.mutate(wholeHome ? { wholeHomeConfirmed: true } : { segments })}
          >
            {MASK_COPY.saveLater}
          </Button>
        </div>
        {!answered ? (
          <p className="mb-0 mt-3 text-sm text-ink-secondary" data-testid="mask-send-blocked">
            {MASK_COPY.sendBlocked}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-0 mt-3 text-sm text-danger" data-testid="mask-error">
            {error}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className={notice ? "mb-0 mt-3 text-sm" : "sr-only"}>
          {notice ?? ""}
        </p>
      </Card>

      <Surface as="section" aria-labelledby="mask-next-heading">
        <h2 id="mask-next-heading" className="m-0 text-base font-semibold">
          What happens next
        </h2>
        <p className="mb-0 mt-2 text-sm text-ink-secondary">{MASK_COPY.whatHappensNext}</p>
      </Surface>
    </>
  );
}
