import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  DataList,
  DataRow,
  Dialog,
  PageHeader,
  Skeleton,
  StatusMessage,
  Surface,
  TextInput,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { HONESTY_HOST_SHEET, HONESTY_REFUSALS, SCAN_REASON_COPY } from "../lib/honestyCopy";
import {
  bookendMeter,
  captureSupport,
  formatElapsed,
  guidanceAt,
  readoutFor,
  SampleBuffer,
  type BookendMeter,
  type CaptureSample,
  type LocationPermission,
} from "../lib/scanCapture";
import {
  uploadWalk,
  UploadError,
  type UploadPhase,
  type UploadProgress,
  type UploadSession,
  type UploadTransport,
} from "../lib/scanUpload";
import type { ListingDetail, ListingScan, ListingScanStatus, ScanThresholds, ScanUploadKind } from "../lib/types";

/**
 * HM-01 — the capture page (HM-D01).
 *
 * Records a phone walk with continuous location samples. What this page may
 * decide: which readout to show, whether the on-device meter thinks the
 * start bookend is met, whether Finish is enabled. What it may never decide:
 * the verdict. Samples are recorded with the recording clock and judged on
 * the server after upload (HM-02): Finish hands the recording to the upload
 * step, which sends the three objects and asks for the verdict.
 */
export function HostListingScanPage() {
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

  const backTo = listingId ? `/host/listings/${listingId}` : "/host/listings";

  if (status !== "signed_in") {
    return (
      <Shell focused width="narrow" workspace="hosting" title="Scan your home" backTo={backTo} backLabel="Edit your home">
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

  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;

  return (
    <Shell focused width="narrow" workspace="hosting" title="Scan your home" backTo={backTo} backLabel="Edit your home">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        {listingQuery.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p role="status" className="sr-only">
              Loading this home
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="aspect-[3/4] w-full" />
          </div>
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
              title="This home isn't yours to scan."
              description="Only the homeowner can scan a listing. You can still view it as a guest would."
            />
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/listing/${listing.id}`}>View this home</ButtonLink>
              <ButtonLink to="/host/listings" variant="secondary">
                Your homes
              </ButtonLink>
            </div>
          </>
        ) : scanQuery.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p role="status" className="sr-only">
              Checking this home's scan
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="aspect-[3/4] w-full" />
          </div>
        ) : scanQuery.isError || !scanQuery.data ? (
          <StatusMessage
            tone="danger"
            title="We couldn't check this home's scan."
            action={
              <Button variant="secondary" size="sm" onClick={() => void scanQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <Capture listing={listing} status={scanQuery.data} />
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

type Phase = "idle" | "starting" | "recording" | "paused" | "capped" | "finished";

type Blocker = { title: string; body: string };

type Recording = {
  blob: Blob | null;
  mimeType: string;
  /** Wall clock at the first frame, for the listing-local "Captured {date}". */
  startedAt: string;
  durationMs: number;
  samples: CaptureSample[];
  pauses: { fromMs: number; toMs: number }[];
  meter: BookendMeter;
  videoWidth: number | null;
  videoHeight: number | null;
};

const CAMERA_DENIED: Blocker = {
  title: "We need the camera to film the walk.",
  body: "Allow camera access for this site, then try again.",
};
const LOCATION_DENIED: Blocker = {
  title: "We need your phone's location while you walk.",
  body: "Allow location for this site, then try again.",
};
const OUT_OF_SPACE: Blocker = {
  title: "Your phone ran out of space.",
  body: "Free some up and walk again.",
};

const BEFORE_START = "Start outside the front door so your phone gets a clear fix, then walk in.";
const ENDING = "Finish outside the front door, then tap Finish the walk.";
const KEEP_OPEN = "Keep the screen on and this page open.";
const CAPPED = "That's the longest walk we can process. Finish outside now.";
const SCREEN_LOCKED = "We paused when the screen locked. Keep the screen on and tap Resume.";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function Capture({ listing, status }: { listing: ListingDetail; status: ListingScanStatus }) {
  const thresholds = status.thresholds;

  // -- device -----------------------------------------------------------
  const [device, setDevice] = useState<"checking" | "camera" | "none">("checking");
  useEffect(() => {
    let cancelled = false;
    const support = captureSupport(navigator, typeof MediaRecorder !== "undefined");
    if (!support.ok) {
      setDevice("none");
      return;
    }
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (!cancelled) setDevice(devices.some((d) => d.kind === "videoinput") ? "camera" : "none");
      })
      .catch(() => {
        if (!cancelled) setDevice("none");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -- capture state ----------------------------------------------------
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [readout, setReadout] = useState(readoutFor(null, "prompt", thresholds));
  const [meter, setMeter] = useState<BookendMeter>(() => bookendMeter([], 0, thresholds));
  const [recording, setRecording] = useState<Recording | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const bufferRef = useRef(new SampleBuffer());
  const pausesRef = useRef<{ fromMs: number; toMs: number }[]>([]);
  const clockRef = useRef<{ accumulatedMs: number; segmentStartedAt: number | null }>({
    accumulatedMs: 0,
    segmentStartedAt: null,
  });
  const latestFixRef = useRef<{ acc: number } | null>(null);
  const permissionRef = useRef<LocationPermission>("prompt");
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const mimeTypeRef = useRef("");
  const startedAtRef = useRef("");
  const scanRef = useRef<ListingScan | null>(null);

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  const elapsed = useCallback((): number => {
    const clock = clockRef.current;
    return clock.accumulatedMs + (clock.segmentStartedAt !== null ? performance.now() - clock.segmentStartedAt : 0);
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) void lock.release().catch(() => {});
  }, []);

  const stopEverything = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    clockRef.current.segmentStartedAt = null;
    releaseWakeLock();
  }, [releaseWakeLock]);

  useEffect(() => stopEverything, [stopEverything]);

  const pauseWalk = useCallback(
    (next: "paused" | "capped") => {
      if (phaseRef.current !== "recording") return;
      const at = elapsed();
      clockRef.current.accumulatedMs = at;
      clockRef.current.segmentStartedAt = null;
      pausesRef.current.push({ fromMs: Math.round(at), toMs: Math.round(at) });
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") recorder.pause();
      setPhaseBoth(next);
    },
    [elapsed],
  );

  function resumeWalk() {
    if (phaseRef.current !== "paused") return;
    const last = pausesRef.current[pausesRef.current.length - 1];
    if (last) last.toMs = Math.round(clockRef.current.accumulatedMs);
    clockRef.current.segmentStartedAt = performance.now();
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "paused") recorder.resume();
    setNotice(null);
    setPhaseBoth("recording");
  }

  // The clock, the meter and the cap. Runs while a walk is live.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused" && phase !== "capped") return;
    const tick = window.setInterval(() => {
      const now = elapsed();
      setElapsedMs(now);
      setMeter(bookendMeter(bufferRef.current.toArray(), now, thresholds));
      if (phaseRef.current === "recording" && now >= thresholds.maxSeconds * 1000) {
        pauseWalk("capped");
        setNotice(CAPPED);
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [phase, elapsed, pauseWalk, thresholds]);

  // The readout is announced politely, so it updates at most every 5 s.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused" && phase !== "capped" && phase !== "starting") return;
    const update = () => setReadout(readoutFor(latestFixRef.current, permissionRef.current, thresholds));
    update();
    const timer = window.setInterval(update, 5000);
    return () => window.clearInterval(timer);
  }, [phase, thresholds]);

  // A backgrounded tab stops location updates; say so rather than stitch
  // across a gap silently.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && phaseRef.current === "recording") {
        pauseWalk("paused");
        setNotice(SCREEN_LOCKED);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pauseWalk]);

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Not available; the page still says to keep the screen on.
    }
  }

  function onFix(position: GeolocationPosition) {
    permissionRef.current = "granted";
    const acc = position.coords.accuracy;
    latestFixRef.current = { acc };
    if (phaseRef.current !== "recording") return;
    bufferRef.current.add({
      t: Math.round(elapsed()),
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      acc,
    });
  }

  function onGeoError(error: GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      permissionRef.current = "denied";
      stopEverything();
      setPhaseBoth("idle");
      setBlocker(LOCATION_DENIED);
    }
    // A timeout or a temporary unavailability keeps the readout at "waiting".
  }

  async function startWalk() {
    setSheetOpen(false);
    setBlocker(null);
    setNotice(null);
    setRecording(null);
    setPhaseBoth("starting");
    try {
      scanRef.current = await api.startScan(listing.id);
    } catch (err) {
      setPhaseBoth("idle");
      setBlocker({
        title: "We couldn't start the scan.",
        body: err instanceof ApiError ? err.message : "Please try again.",
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      setPhaseBoth("idle");
      setBlocker(CAMERA_DENIED);
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }

    if (!navigator.geolocation) {
      stopEverything();
      setPhaseBoth("idle");
      setBlocker(LOCATION_DENIED);
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(onFix, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });

    try {
      const mimeType = pickMimeType();
      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopEverything();
        setPhaseBoth("idle");
        setBlocker(OUT_OF_SPACE);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
    } catch {
      stopEverything();
      setPhaseBoth("idle");
      setBlocker(OUT_OF_SPACE);
      return;
    }

    bufferRef.current = new SampleBuffer();
    pausesRef.current = [];
    clockRef.current = { accumulatedMs: 0, segmentStartedAt: performance.now() };
    startedAtRef.current = new Date().toISOString();
    setElapsedMs(0);
    setPhaseBoth("recording");
    void requestWakeLock();
  }

  async function finishWalk() {
    if (phaseRef.current !== "recording" && phaseRef.current !== "paused" && phaseRef.current !== "capped") return;
    const durationMs = Math.round(phaseRef.current === "recording" ? elapsed() : clockRef.current.accumulatedMs);
    const recorder = recorderRef.current;
    const stopped = new Promise<void>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    stopEverything();
    await stopped;
    const samples = bufferRef.current.toArray();
    const mimeType = mimeTypeRef.current || "video/webm";
    const track = streamRef.current?.getVideoTracks()[0]?.getSettings();
    setRecording({
      blob: chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mimeType }) : null,
      mimeType,
      startedAt: startedAtRef.current || new Date().toISOString(),
      durationMs,
      samples,
      pauses: [...pausesRef.current],
      meter: bookendMeter(samples, durationMs, thresholds),
      videoWidth: track?.width ?? null,
      videoHeight: track?.height ?? null,
    });
    setPhaseBoth("finished");
  }

  function walkAgain() {
    stopEverything();
    chunksRef.current = [];
    bufferRef.current = new SampleBuffer();
    pausesRef.current = [];
    latestFixRef.current = null;
    setRecording(null);
    setNotice(null);
    setBlocker(null);
    setElapsedMs(0);
    setMeter(bookendMeter([], 0, thresholds));
    setPhaseBoth("idle");
    setSheetOpen(true);
  }

  // -- preconditions ------------------------------------------------------
  const heading = (
    <PageHeader title={`Scan ${listing.title || "this home"}`} description="A walk through the home, filmed on your phone." />
  );

  if (!status.coordinatesConfirmed) {
    return (
      <>
        {heading}
        <StatusMessage tone="warning" live={false} title={HONESTY_REFUSALS.coordinatesUnconfirmed} testId="scan-needs-door">
          <p>The walk is checked against the front door you confirm in the editor.</p>
        </StatusMessage>
        <ButtonLink to={`/host/listings/${listing.id}#where`} className="self-start">
          Confirm the home's location
        </ButtonLink>
      </>
    );
  }

  if (!status.storageConfigured) {
    return (
      <>
        {heading}
        <StatusMessage tone="danger" live={false} title={HONESTY_REFUSALS.storageNotConfigured}>
          <p>There is nowhere for a walk to go on this deployment, so the camera stays closed.</p>
        </StatusMessage>
      </>
    );
  }

  if (device === "checking") {
    return (
      <>
        {heading}
        <div aria-busy="true">
          <p role="status" className="sr-only">
            Checking this device for a camera
          </p>
          <Skeleton className="aspect-[3/4] w-full" />
        </div>
      </>
    );
  }

  if (device === "none") {
    return (
      <>
        {heading}
        <OpenOnPhone title={listing.title || "this home"} />
      </>
    );
  }

  // -- the walk ----------------------------------------------------------
  const live = phase === "recording" || phase === "paused" || phase === "capped";
  const finishEnabled = phase === "capped" || (live && meter.canFinish);
  const guidance =
    phase === "recording" || phase === "paused"
      ? meter.canFinish
        ? ENDING
        : guidanceAt(elapsedMs)
      : phase === "capped"
        ? ENDING
        : BEFORE_START;

  return (
    <>
      {heading}

      <Dialog
        open={sheetOpen && phase === "idle" && !blocker}
        onClose={() => setSheetOpen(false)}
        title={HONESTY_HOST_SHEET.title}
        size="md"
      >
        <div className="flex flex-col gap-4">
          {HONESTY_HOST_SHEET.sections.map((section) => (
            <p key={section.heading} className="m-0 text-sm leading-relaxed">
              <strong>{section.heading}</strong> {section.body}
            </p>
          ))}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button autoFocus onClick={() => void startWalk()}>
              {HONESTY_HOST_SHEET.start}
            </Button>
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>
              {HONESTY_HOST_SHEET.dismiss}
            </Button>
          </div>
        </div>
      </Dialog>

      {blocker ? (
        <StatusMessage
          tone="warning"
          title={blocker.title}
          action={
            <Button variant="secondary" size="sm" onClick={() => void startWalk()}>
              Try again
            </Button>
          }
        >
          <p>{blocker.body}</p>
        </StatusMessage>
      ) : null}

      {phase === "finished" && recording ? (
        <UploadStep
          listing={listing}
          scan={scanRef.current}
          policyVersion={status.policyVersion}
          recording={recording}
          thresholds={thresholds}
          onWalkAgain={walkAgain}
        />
      ) : (
        <>
          <div className="relative overflow-hidden rounded-surface bg-surface" style={{ aspectRatio: "3 / 4" }}>
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              autoPlay
              aria-hidden
            />
            {!live && phase !== "starting" ? (
              <div className="absolute inset-0 flex items-center justify-center px-6">
                <p className="m-0 text-center text-sm text-ink-secondary">Live camera view appears here.</p>
              </div>
            ) : null}
          </div>

          <Surface padding="sm">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="money m-0 text-lg font-semibold" aria-label="Elapsed time">
                {formatElapsed(elapsedMs)}
              </p>
              <p role="status" aria-live="polite" className="m-0 text-sm font-semibold" data-testid="scan-readout">
                {readout}
              </p>
            </div>
            <p className="mb-0 mt-2 text-sm text-ink-secondary">{guidance}</p>
            <p className="mb-0 mt-1 text-sm text-ink-secondary">{KEEP_OPEN}</p>
            {live ? (
              <ul className="m-0 mt-3 list-none p-0 text-sm">
                <li>
                  Outdoor fix at the start:{" "}
                  {meter.startMet
                    ? `✓ (${meter.startCount} readings)`
                    : `not yet (${meter.startCount} of ${thresholds.bookendMinSamples})`}
                </li>
                {meter.indoorMet ? (
                  <li>
                    Outdoor fix at the end:{" "}
                    {meter.endMet ? `✓ (${meter.endCount} readings)` : `not yet (${meter.endCount} of ${thresholds.bookendMinSamples})`}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </Surface>

          {notice ? (
            <StatusMessage tone="info" title={notice} />
          ) : null}

          <div className="flex flex-col gap-3">
            {phase === "idle" && !sheetOpen ? (
              <Button block onClick={() => setSheetOpen(true)}>
                {HONESTY_HOST_SHEET.start}
              </Button>
            ) : null}
            {phase === "starting" ? (
              <Button block busy busyLabel="Starting…">
                {HONESTY_HOST_SHEET.start}
              </Button>
            ) : null}
            {phase === "recording" ? (
              <Button block variant="secondary" onClick={() => pauseWalk("paused")}>
                Pause
              </Button>
            ) : null}
            {phase === "paused" ? (
              <Button block variant="secondary" onClick={resumeWalk}>
                Resume
              </Button>
            ) : null}
            {live ? (
              <>
                <Button block disabled={!finishEnabled} onClick={() => void finishWalk()}>
                  Finish the walk
                </Button>
                {!finishEnabled && meter.reason ? (
                  <p className="m-0 text-sm text-ink-secondary">{meter.reason}</p>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

function OpenOnPhone({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card data-testid="scan-open-on-phone">
      <h2 className="m-0 text-card-title">Open this page on your phone to scan {title}.</h2>
      <p className="mb-0 mt-2 text-sm text-ink-secondary">
        Scanning needs a phone camera and continuous location. This device doesn't report a camera.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <TextInput label="Link to this page" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            Copy link
          </Button>
          <p role="status" className="m-0 text-sm text-ink-secondary">
            {copied ? "Copied." : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}

type UploadOutcome =
  | { kind: "idle" }
  | { kind: "running"; phase: UploadPhase }
  | { kind: "failed"; message: string; resumable: boolean; walkAgain: boolean }
  | { kind: "done"; scan: ListingScan };

const ROW_LABEL: Record<ScanUploadKind, string> = {
  video: "Video",
  attestation: "Location record",
  notes: "Camera notes",
};

function megabytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 100_000) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
}

function transportFor(listingId: string, scanId: string): UploadTransport {
  return {
    target: (kind, contentType) => api.scanUploadTarget(listingId, scanId, { kind, contentType }),
    partUrl: (key, uploadId, partNumber) => api.scanUploadPartUrl(listingId, scanId, { key, uploadId, partNumber }),
    uploadedParts: async (key, uploadId) => (await api.scanUploadedParts(listingId, scanId, key, uploadId)).parts,
    put: (url, body, contentType) => api.putToBucket(url, body, contentType),
    finish: (key, uploadId) => api.finishScanUpload(listingId, scanId, { key, uploadId }),
    complete: (videoKey) => api.completeScan(listingId, scanId, { videoKey }),
  };
}

/**
 * HM-02 — the upload step (HM-D03).
 *
 * Runs the upload as soon as the walk is finished, one row per object with
 * its own progress, and never says "verified" or "queued" from its own
 * state: the receipt is whatever the server answered. A dropped connection
 * leaves the session in place, and Finish uploading resumes from the parts
 * the bucket already holds.
 */
function UploadStep({
  listing,
  scan,
  policyVersion,
  recording,
  thresholds,
  onWalkAgain,
}: {
  listing: ListingDetail;
  scan: ListingScan | null;
  policyVersion: number;
  recording: Recording;
  thresholds: ScanThresholds;
  onWalkAgain: () => void;
}) {
  const [rows, setRows] = useState<UploadProgress[]>([]);
  const [outcome, setOutcome] = useState<UploadOutcome>({ kind: "idle" });
  const sessionRef = useRef<UploadSession>({});
  const startedRef = useRef(false);

  const run = useCallback(async () => {
    if (!scan || !recording.blob) return;
    setOutcome({ kind: "running", phase: "uploading" });
    try {
      const result = await uploadWalk(
        transportFor(listing.id, scan.id),
        {
          scanId: scan.id,
          listingId: listing.id,
          policyVersion,
          blob: recording.blob,
          mimeType: recording.mimeType,
          startedAt: recording.startedAt,
          durationMs: recording.durationMs,
          samples: recording.samples,
          pauses: recording.pauses,
          client: {
            userAgent: navigator.userAgent,
            platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? null,
            videoWidth: recording.videoWidth ?? undefined,
            videoHeight: recording.videoHeight ?? undefined,
          },
        },
        {
          session: sessionRef.current,
          onProgress: (next, phase) => {
            setRows(next.map((row) => ({ ...row })));
            setOutcome((current) => (current.kind === "running" ? { kind: "running", phase } : current));
          },
        },
      );
      sessionRef.current = result.session;
      setOutcome({ kind: "done", scan: result.scan });
    } catch (err) {
      if (err instanceof UploadError) {
        setOutcome({ kind: "failed", message: err.message, resumable: true, walkAgain: false });
        return;
      }
      if (err instanceof ApiError) {
        const walkAgain =
          err.message === HONESTY_REFUSALS.uploadTooLarge ||
          err.message === HONESTY_REFUSALS.attestationUnreadable ||
          err.message === HONESTY_REFUSALS.alreadySubmitted;
        setOutcome({ kind: "failed", message: err.message, resumable: !walkAgain, walkAgain });
        return;
      }
      setOutcome({ kind: "failed", message: "The upload lost connection.", resumable: true, walkAgain: false });
    }
  }, [listing.id, policyVersion, recording, scan]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [run]);

  const noRecording = !scan || !recording.blob;

  return (
    <>
      <Card>
        <h2 className="m-0 text-card-title">Uploading your walk</h2>
        {noRecording ? (
          <div className="mt-4">
            <StatusMessage tone="warning" title="There's nothing to upload." live={false}>
              <p>The recording didn't reach this page. Walk again to try once more.</p>
            </StatusMessage>
          </div>
        ) : (
          <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            {(["video", "attestation", "notes"] as const).map((kind) => {
              const row = rows.find((r) => r.kind === kind) ?? {
                kind,
                status: "waiting" as const,
                doneBytes: 0,
                totalBytes: kind === "video" ? (recording.blob?.size ?? 0) : 0,
              };
              const percent = row.totalBytes > 0 ? Math.round((row.doneBytes / row.totalBytes) * 100) : row.status === "done" ? 100 : 0;
              const word =
                row.status === "done"
                  ? "Uploaded"
                  : row.status === "failed"
                    ? "Didn't finish"
                    : row.status === "preparing"
                      ? "Preparing…"
                      : row.status === "uploading"
                        ? `${megabytes(row.doneBytes)} of ${megabytes(row.totalBytes)}`
                        : "Waiting";
              return (
                <li key={kind} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold">{ROW_LABEL[kind]}</span>
                    <span className="money text-ink-secondary">{word}</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={ROW_LABEL[kind]}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="h-2 w-full overflow-hidden rounded-full bg-surface"
                  >
                    <div className="h-full bg-brand transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mb-0 mt-4 text-sm text-ink-secondary">Keep this page open until the upload finishes.</p>
      </Card>

      {outcome.kind === "running" ? (
        <p role="status" className="m-0 text-sm font-semibold">
          {outcome.phase === "checking" ? "Checking the package…" : "Uploading…"}
        </p>
      ) : null}

      {outcome.kind === "failed" ? (
        <StatusMessage
          tone="warning"
          title={outcome.message}
          action={
            outcome.resumable ? (
              <Button variant="secondary" size="sm" onClick={() => void run()}>
                Finish uploading
              </Button>
            ) : outcome.walkAgain ? (
              <Button variant="secondary" size="sm" onClick={onWalkAgain}>
                Walk again
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {outcome.kind === "done" ? <Receipt scan={outcome.scan} listingId={listing.id} onWalkAgain={onWalkAgain} /> : null}

      <WhatThePhoneSaw recording={recording} thresholds={thresholds} />

      {outcome.kind !== "running" ? (
        <div className="flex flex-wrap gap-3">
          {outcome.kind !== "done" ? (
            <Button variant="secondary" onClick={onWalkAgain}>
              Walk again
            </Button>
          ) : null}
          <ButtonLink to={`/host/listings/${listing.id}`} variant="secondary">
            Back to the home
          </ButtonLink>
        </div>
      ) : null}
    </>
  );
}

/** The server's answer, verbatim. Uploaded means queued for processing; rejected carries its reason. */
function Receipt({ scan, listingId, onWalkAgain }: { scan: ListingScan; listingId: string; onWalkAgain: () => void }) {
  if (scan.state === "uploaded") {
    return (
      <StatusMessage tone="success" title="Uploaded. Location confirmed — queued for processing." testId="scan-receipt">
        <p>Processing can take a while — often hours. We'll email you when it's done.</p>
      </StatusMessage>
    );
  }
  if (scan.state === "rejected") {
    return (
      <StatusMessage
        tone="warning"
        title="Uploaded, but we couldn't confirm the location."
        testId="scan-receipt"
        action={
          <>
            <Button variant="secondary" size="sm" onClick={onWalkAgain}>
              Walk again
            </Button>
            {scan.reason === "location_mismatch" ? (
              <ButtonLink to={`/host/listings/${listingId}#where`} variant="secondary" size="sm">
                Check the home's location
              </ButtonLink>
            ) : null}
          </>
        }
      >
        <p>{scan.reason ? SCAN_REASON_COPY[scan.reason] : ""}</p>
      </StatusMessage>
    );
  }
  return (
    <StatusMessage tone="info" title="Uploaded." testId="scan-receipt">
      <p>The server recorded the walk.</p>
    </StatusMessage>
  );
}

/**
 * What the phone recorded, stated as what the phone saw. The two bookend
 * lines mirror the on-device meter; they are not a verdict, and the copy
 * says so.
 */
function WhatThePhoneSaw({ recording, thresholds }: { recording: Recording; thresholds: ScanThresholds }) {
  const { meter } = recording;
  return (
    <Card>
      <DataList>
        <DataRow label="Video length" value={formatElapsed(recording.durationMs)} />
        <DataRow label="Location readings" value={String(recording.samples.length)} />
        <DataRow
          label="Outdoor fix at the start"
          value={meter.startMet ? `Yes (${meter.startCount} readings)` : `Not yet (${meter.startCount} of ${thresholds.bookendMinSamples})`}
        />
        <DataRow
          label="Outdoor fix at the end"
          value={meter.endMet ? `Yes (${meter.endCount} readings)` : `Not yet (${meter.endCount} of ${thresholds.bookendMinSamples})`}
        />
        <DataRow label="Paused" value={`${recording.pauses.length} ${recording.pauses.length === 1 ? "time" : "times"}`} />
      </DataList>
      <p className="mb-0 mt-4 text-sm text-ink-secondary">
        These are what your phone saw. Whether the walk is verified is decided by the server after upload, never here.
      </p>
    </Card>
  );
}
