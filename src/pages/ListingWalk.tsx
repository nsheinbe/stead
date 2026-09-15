/**
 * HM-05 — /listing/:id/walk (HM-D07).
 *
 * The walk is its own route, not a canvas inside a scrolling page, so touch
 * gestures are unambiguous and Explore never pays the Three.js cost
 * (DECISIONS D20). The viewer itself is a lazy chunk imported only once this
 * device has said it can render: a guest without WebGL downloads none of it
 * and gets real frames from the host's walk instead.
 *
 * Nothing here autoplays, and no fallback is ever a generated stand-in.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { formatInTimeZone } from "date-fns-tz";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { Button, ButtonLink, Dialog, Skeleton, StatusMessage, StatusPill } from "../components/ui";
import { api, ApiError } from "../lib/api";
import {
  HONESTY_BADGE,
  HONESTY_CAPTURED,
  HONESTY_GUEST_DISCLOSURE,
  HONESTY_REFUSALS,
  WALK_COPY,
} from "../lib/honestyCopy";
import { defaultStorage } from "../lib/storage";
import {
  detectWebgl,
  initialMode,
  offersThreeD,
  prefersReducedMotion,
  progressParts,
  type DeviceSupport,
  type LoadProgress,
  type WalkMode,
} from "../lib/walkthrough";
import type { Walkthrough } from "../lib/types";

const SplatViewer = lazy(() => import("../components/walk/SplatViewer"));

const CONTROLS_SEEN = "stead.walk.controls-seen";

export function ListingWalkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const walkQuery = useQuery({
    queryKey: ["walkthrough", id],
    enabled: Boolean(id),
    queryFn: () => api.walkthrough(id as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const notFound = walkQuery.error instanceof ApiError && walkQuery.error.status === 404;
  const walk = walkQuery.data;
  const backTo = id ? `/listing/${id}` : "/explore";

  // Esc leaves the walk. The dialog closes itself first (Dialog's contract).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") navigate(backTo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, backTo]);

  if (walkQuery.isPending) {
    return (
      <Shell focused width="full" title="Walkthrough" backTo={backTo} backLabel="Home details">
        <div className="flex flex-1 flex-col gap-3 py-6" aria-busy="true">
          <p role="status" className="sr-only">
            Loading the walkthrough
          </p>
          <Skeleton className="h-[60vh] w-full" />
        </div>
      </Shell>
    );
  }

  if (notFound || !walk) {
    return (
      <Shell focused width="narrow" title="Walkthrough" backTo={backTo} backLabel="Home details">
        <div className="flex flex-1 flex-col gap-4 py-8">
          <h1 className="m-0 text-page-title">We couldn't find this walkthrough.</h1>
          <p className="m-0 text-ink-secondary">
            It may not be published yet, or the link may be out of date.
          </p>
          <ButtonLink to={backTo} className="self-start">
            Home details
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  return <Walk walk={walk} backTo={backTo} onRefresh={() => void walkQuery.refetch()} />;
}

// ---------------------------------------------------------------------------

function Walk({ walk, backTo, onRefresh }: { walk: Walkthrough; backTo: string; onRefresh: () => void }) {
  // Decided once, from the real device, before the viewer chunk is imported.
  const [support] = useState<DeviceSupport>(() => ({
    webgl: detectWebgl(),
    reducedMotion: prefersReducedMotion(),
  }));
  const [mode, setMode] = useState<WalkMode>(() => initialMode(support));
  const [progress, setProgress] = useState<LoadProgress>({ loadedBytes: 0, totalBytes: null });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // A per-viewer convenience. No storage just means the map shows again.
  const [controlsOpen, setControlsOpen] = useState(() => defaultStorage()?.getItem(CONTROLS_SEEN) !== "1");
  // One silent retry for a signed URL that expired mid-walk (HM-D07 §4).
  const retried = useRef(false);

  const capturedOn = useMemo(
    () => (walk.capturedOn ? formatInTimeZone(`${walk.capturedOn}T12:00:00Z`, walk.timezone, "d MMM yyyy") : null),
    [walk.capturedOn, walk.timezone],
  );
  const coverage = HONESTY_CAPTURED.coverage[walk.coverage];
  const parts = progressParts(progress);

  function onFailed() {
    if (!retried.current) {
      retried.current = true;
      onRefresh();
      return;
    }
    setFailed(true);
    setMode("stills");
  }

  function dismissControls() {
    defaultStorage()?.setItem(CONTROLS_SEEN, "1");
    setControlsOpen(false);
  }

  return (
    <Shell focused width="full" title="Walkthrough" backTo={backTo} backLabel="Home details">
      <div className="flex flex-1 flex-col">
        {/* -- chrome, on an opaque strip rather than over the render ---- */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-canvas px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 truncate text-base font-semibold">{walk.title} — walkthrough</h1>
            <StatusPill tone="brand" testId="walk-badge">
              <span className="hidden sm:inline">{HONESTY_BADGE.full}</span>
              <span className="sm:hidden">{HONESTY_BADGE.short}</span>
            </StatusPill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAboutOpen(true)}>
              {HONESTY_GUEST_DISCLOSURE.title}
            </Button>
            {support.webgl ? (
              <Button variant="secondary" size="sm" onClick={() => setControlsOpen(true)}>
                {WALK_COPY.controls}
              </Button>
            ) : null}
            <ButtonLink to={backTo} variant="secondary" size="sm">
              {WALK_COPY.leave}
            </ButtonLink>
          </div>
        </div>

        {walk.ownerPreview ? (
          <StatusMessage
            tone="warning"
            live={false}
            title="You're previewing your own listing."
            className="m-4"
            testId="walk-owner-preview"
          >
            <p>{WALK_COPY.ownerPreview}</p>
          </StatusMessage>
        ) : null}

        {/* -- the walk, or the frames --------------------------------- */}
        {mode === "three_d" ? (
          <div className="relative min-h-[60vh] flex-1 bg-surface">
            <Suspense fallback={<LoadingLine parts={null} />}>
              <SplatViewer
                url={walk.splatUrl}
                title={walk.title}
                onProgress={setProgress}
                onReady={() => setReady(true)}
                onFailed={onFailed}
              />
            </Suspense>
            {!ready ? <LoadingLine parts={parts} /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {failed ? (
              <StatusMessage
                tone="danger"
                title={WALK_COPY.loadFailed}
                testId="walk-failed"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      retried.current = false;
                      setFailed(false);
                      setReady(false);
                      setMode("three_d");
                    }}
                  >
                    Try again
                  </Button>
                }
              />
            ) : !support.webgl ? (
              <StatusMessage tone="info" live={false} title={HONESTY_REFUSALS.webglUnavailable} testId="walk-no-webgl" />
            ) : (
              <p className="m-0 text-sm text-ink-secondary" data-testid="walk-reduced-motion">
                {WALK_COPY.reducedMotion}
              </p>
            )}

            <Stills walk={walk} />

            {offersThreeD(support, mode) && !failed ? (
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => {
                  setReady(false);
                  setMode("three_d");
                }}
                data-testid="walk-show-3d"
              >
                {WALK_COPY.showThreeD}
              </Button>
            ) : null}
          </div>
        )}

        {/* -- the facts, always in reach ------------------------------ */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider bg-canvas px-4 py-3 text-sm">
          {capturedOn ? <span data-testid="walk-captured">{HONESTY_CAPTURED.capturedOn(capturedOn)}</span> : null}
          <span data-testid="walk-coverage">
            <strong>{coverage.label}</strong> — {coverage.body}
          </span>
        </div>
      </div>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title={HONESTY_GUEST_DISCLOSURE.title}>
        {HONESTY_GUEST_DISCLOSURE.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="mt-0 text-sm leading-relaxed">
            {paragraph}
          </p>
        ))}
        {capturedOn ? (
          <p className="mb-0 text-sm">
            {HONESTY_CAPTURED.capturedOn(capturedOn)}. {HONESTY_CAPTURED.hint}
          </p>
        ) : null}
      </Dialog>

      <Dialog open={controlsOpen && mode === "three_d"} onClose={dismissControls} title={WALK_COPY.controls}>
        <p className="mt-0 text-sm leading-relaxed">{WALK_COPY.controlMap}</p>
        <Button onClick={dismissControls}>{WALK_COPY.gotIt}</Button>
      </Dialog>
    </Shell>
  );
}

function LoadingLine({ parts }: { parts: { loadedMb: number; totalMb: number } | null }) {
  return (
    <p
      role="status"
      className="absolute inset-x-0 top-4 m-0 text-center text-sm"
      data-testid="walk-loading"
    >
      <span className="money rounded-control bg-canvas/90 px-3 py-1">
        {parts ? WALK_COPY.loading(parts.loadedMb, parts.totalMb) : WALK_COPY.loadingUnknown}
      </span>
    </p>
  );
}

/** Real frames the worker saved from the walk. Never a stand-in. */
function Stills({ walk }: { walk: Walkthrough }) {
  if (walk.stills.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-secondary" data-testid="walk-no-stills">
        We don't have frames from this walk to show.
      </p>
    );
  }
  return (
    <figure className="m-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="walk-stills">
        {walk.stills.map((still) => (
          <ListingPhoto key={still.index} src={still.url} alt="" aspect="4/3" className="rounded-surface" />
        ))}
      </div>
      <figcaption className="mt-2 text-sm text-ink-secondary">{WALK_COPY.stillsCaption}</figcaption>
    </figure>
  );
}
