import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { Button, ButtonLink, Dialog, Skeleton, StatusMessage } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { HM, hm } from "../lib/honesty";
import {
  bookendReady,
  classifyFix,
  formatElapsed,
  hasCaptureSupport,
  phaseForStage,
  pickRecorderMimeType,
  toSample,
  type CaptureStage,
  type FixQuality,
} from "../lib/scanCapture";
import { clearScan, countChunks, putChunk, putMeta, readMeta } from "../lib/scanStore";
import type { ScanLocationSample, ScanThresholds } from "../lib/types";

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
/** Nudge the sensor when the watch goes quiet, so the record has no gaps. */
const KEEPALIVE_MS = 10_000;

type Permission = "unknown" | "granted" | "denied";

/**
 * The viewfinder (HM-D01). Phone-first; the page records video into local
 * storage and a continuous location record in memory (persisted as it grows),
 * then sends only the location record to the server, which judges it. The
 * recording stays on this phone until HM-02's upload.
 *
 * Nothing here decides anything. The buttons only light up when the record
 * could pass; the server still says whether it did.
 */
export function HostListingScanCapturePage() {
  const { listingId } = useParams<{ listingId: string }>();
  const [params] = useSearchParams();
  const scanId = params.get("scan");
  const navigate = useNavigate();
  const { status } = useAuth();

  const hub = useQuery({
    queryKey: ["host-scan", listingId],
    enabled: Boolean(listingId) && status === "signed_in",
    queryFn: () => api.hostScan(listingId as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const hubHref = `/host/listings/${listingId}/scan`;
  const scan = hub.data?.scan ?? null;
  const current = Boolean(scan && scanId && scan.id === scanId && scan.state === "capturing" && scan.geofence === "pending");
  const thresholds: ScanThresholds | null = scan?.thresholds ?? null;

  if (status !== "signed_in") {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
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

  if (hub.isPending) {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
        <div className="py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this walk
          </p>
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  if (!current || !thresholds || !scanId || !listingId) {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
        <div className="flex flex-col gap-4 py-8">
          <StatusMessage tone="info" live={false} title={HM["hm.capture.notCurrent"]} />
          <ButtonLink to={hubHref} className="self-start">
            {HM["hm.hub.title"]}
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  return (
    <Viewfinder
      listingId={listingId}
      scanId={scanId}
      thresholds={thresholds}
      hubHref={hubHref}
      onFinished={() => navigate(hubHref)}
    />
  );
}

function Viewfinder({
  listingId,
  scanId,
  thresholds,
  hubHref,
  onFinished,
}: {
  listingId: string;
  scanId: string;
  thresholds: ScanThresholds;
  hubHref: string;
  onFinished: () => void;
}) {
  const navigate = useNavigate();
  const supported =
    typeof navigator !== "undefined" &&
    hasCaptureSupport(navigator, typeof MediaRecorder !== "undefined");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const watchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const samplesRef = useRef<ScanLocationSample[]>([]);
  const memoryChunksRef = useRef<Blob[]>([]);
  const chunkSeqRef = useRef(0);
  const lastPositionAtRef = useRef(0);
  const stageRef = useRef<CaptureStage>("permissions");
  const startedAtRef = useRef<number | null>(null);

  const [stage, setStageState] = useState<CaptureStage>("permissions");
  const [interrupted, setInterrupted] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<Permission>("unknown");
  const [latest, setLatest] = useState<ScanLocationSample | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [backgrounded, setBackgrounded] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);

  const setStage = useCallback((next: CaptureStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);

  // A reload mid-walk loses the recorder. If this scan already has chunks or
  // samples on this phone, the honest answer is "start again from the door".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, chunks] = await Promise.all([readMeta(scanId), countChunks(scanId)]);
        if (!cancelled) setInterrupted(Boolean(chunks > 0 || (meta && meta.samples.length > 0)));
      } catch {
        if (!cancelled) setInterrupted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const persistSamples = useCallback(async () => {
    try {
      await putMeta({
        scanId,
        mimeType: recorderRef.current?.mimeType ?? null,
        samples: samplesRef.current,
        chunkCount: chunkSeqRef.current,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setStorageWarning(true);
    }
  }, [scanId]);

  const onPosition = useCallback(
    (position: GeolocationPosition) => {
      lastPositionAtRef.current = Date.now();
      setLocationPermission("granted");
      const phase = phaseForStage(stageRef.current);
      if (!phase) return;
      const sample = toSample(position, phase);
      samplesRef.current.push(sample);
      setLatest(sample);
      setSampleCount(samplesRef.current.length);
      if (samplesRef.current.length % 10 === 0) void persistSamples();
    },
    [persistSamples],
  );

  const onPositionError = useCallback((error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) setLocationPermission("denied");
  }, []);

  const startLocation = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(onPosition, onPositionError, GEO_OPTIONS);
  }, [onPosition, onPositionError]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      startLocation();
      setStage("outdoor_start");
    } catch {
      setCameraError(HM["hm.perm.camera.title"]);
    }
  }, [setStage, startLocation]);

  // Permissions in order: camera, then location (its prompt fires on the first watch).
  useEffect(() => {
    if (!supported || interrupted !== false) return;
    void startCamera();
    // Only once, when the page becomes usable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, interrupted]);

  // Clock for the location line and the elapsed timer; keep-alive for the sensor.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const keepalive = window.setInterval(() => {
      if (stageRef.current === "permissions" || stageRef.current === "finishing" || stageRef.current === "done") return;
      if (Date.now() - lastPositionAtRef.current > KEEPALIVE_MS) {
        navigator.geolocation.getCurrentPosition(onPosition, onPositionError, GEO_OPTIONS);
      }
    }, KEEPALIVE_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(keepalive);
    };
  }, [onPosition, onPositionError]);

  // Backgrounded: pause the recorder, keep sampling, say so.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && recorderRef.current?.state === "recording") {
        recorderRef.current.pause();
        setPaused(true);
        setBackgrounded(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Release everything on the way out.
  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  const elapsedMs = startedAtRef.current ? now - startedAtRef.current : 0;
  const maxMs = thresholds.maxWalkMinutes * 60_000;

  // The limit: head outside and finish. No silent stop.
  useEffect(() => {
    if (!maxReached && startedAtRef.current && elapsedMs >= maxMs && (stage === "turn" || stage === "indoor")) {
      setMaxReached(true);
      setStage("outdoor_end");
    }
  }, [elapsedMs, maxMs, maxReached, setStage, stage]);

  const quality: FixQuality = classifyFix(latest, now, thresholds.accuracyMaxMeters, locationPermission);
  const canStart = bookendReady(samplesRef.current, "outdoor_start", now, thresholds.accuracyMaxMeters, thresholds.bookendMinSamples);
  const canFinish = bookendReady(samplesRef.current, "outdoor_end", now, thresholds.accuracyMaxMeters, thresholds.bookendMinSamples);

  const beginRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return;
    const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
    });
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const seq = chunkSeqRef.current;
      chunkSeqRef.current += 1;
      putChunk(scanId, seq, event.data).catch(() => {
        memoryChunksRef.current.push(event.data);
        setStorageWarning(true);
      });
    };
    recorder.start(2000);
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setNow(Date.now());
    void navigator.wakeLock?.request("screen").then((lock) => {
      wakeLockRef.current = lock;
    }).catch(() => undefined);
    setStage("turn");
  };

  const stopRecording = () =>
    new Promise<void>((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      recorder.stop();
    });

  const submit = useMutation({
    mutationFn: async () => {
      await stopRecording();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      await persistSamples();
      return api.recordScanLocation(listingId, scanId, { samples: samplesRef.current });
    },
    onSuccess: () => {
      setStage("done");
      onFinished();
    },
  });

  const finishWalk = () => {
    setStage("finishing");
    submit.mutate();
  };

  const discard = useMutation({
    mutationFn: async () => {
      await stopRecording();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      await api.discardScan(listingId, scanId);
      await clearScan(scanId).catch(() => undefined);
    },
    onSuccess: () => navigate(hubHref),
  });

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setPaused(false);
      setBackgrounded(false);
    }
  };

  const locationLine =
    quality === "off"
      ? HM["hm.loc.off"]
      : quality === "none"
        ? HM["hm.loc.none"]
        : hm(quality === "good" ? "hm.loc.good" : "hm.loc.rough", { accuracy: latest?.accuracyMeters ?? 0 });

  if (!supported) {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
        <div className="flex flex-col gap-4 py-8">
          <StatusMessage tone="info" live={false} title={HM["hm.capture.unsupported"]} />
          <ButtonLink to={hubHref} className="self-start">
            {HM["hm.hub.title"]}
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  if (interrupted === null) {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
        <div className="py-8" aria-busy="true">
          <p role="status" className="sr-only">
            {HM["hm.capture.preparing"]}
          </p>
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  if (interrupted) {
    return (
      <Shell focused width="narrow" title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
        <div className="flex flex-col gap-4 py-8">
          <StatusMessage tone="info" live={false} title={HM["hm.capture.interrupted.title"]}>
            <p>{HM["hm.capture.interrupted.body"]}</p>
          </StatusMessage>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" busy={discard.isPending} busyLabel="Deleting…" onClick={() => discard.mutate()}>
              {HM["hm.capture.stop.confirm"]}
            </Button>
            <ButtonLink to={hubHref} variant="secondary">
              {HM["hm.hub.title"]}
            </ButtonLink>
          </div>
          {discard.isError ? <StatusMessage tone="danger" title="We couldn't delete that walk. Please try again." /> : null}
        </div>
      </Shell>
    );
  }

  const prompt =
    stage === "outdoor_start"
      ? HM["hm.capture.outsideStart.prompt"]
      : stage === "turn"
        ? HM["hm.capture.turn.prompt"]
        : stage === "indoor"
          ? HM["hm.capture.recording.prompt"]
          : stage === "outdoor_end"
            ? HM["hm.capture.outsideEnd.prompt"]
            : stage === "finishing"
              ? HM["hm.capture.submitting"]
              : HM["hm.capture.preparing"];

  return (
    <Shell focused title={HM["hm.hub.title"]} backTo={hubHref} backLabel={HM["hm.hub.title"]}>
      <div className="relative -mx-5 flex min-h-[calc(100vh-56px)] flex-col bg-ink text-canvas sm:-mx-8">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden className="absolute inset-0 h-full w-full object-cover" />

        {/* Top strip: what is being recorded, and the location line. */}
        <div className="relative z-10 flex flex-col gap-1 bg-canvas/90 px-5 py-3 text-ink">
          <div className="flex items-baseline justify-between gap-3">
            <p className="m-0 text-sm font-semibold">{HM["hm.hub.title"]}</p>
            <p className="money m-0 text-sm" aria-hidden>
              {startedAtRef.current ? formatElapsed(elapsedMs) : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm" aria-live="polite" aria-atomic="true">
              {locationLine}
            </p>
            <FixMeter quality={quality} />
          </div>
        </div>

        <div className="relative z-10 mt-auto flex flex-col gap-3 bg-canvas/95 px-5 py-4 text-ink">
          {cameraError ? (
            <StatusMessage
              tone="danger"
              title={HM["hm.perm.camera.title"]}
              action={
                <Button variant="secondary" size="sm" onClick={() => void startCamera()}>
                  {HM["hm.perm.retry"]}
                </Button>
              }
            >
              <p>{HM["hm.perm.camera.body"]}</p>
            </StatusMessage>
          ) : null}
          {locationPermission === "denied" ? (
            <StatusMessage
              tone="danger"
              title={HM["hm.perm.location.title"]}
              action={
                <Button variant="secondary" size="sm" onClick={startLocation}>
                  {HM["hm.perm.retry"]}
                </Button>
              }
            >
              <p>{HM["hm.perm.location.body"]}</p>
            </StatusMessage>
          ) : null}
          {maxReached ? (
            <StatusMessage tone="warning" title={hm("hm.capture.maxReached", { maxMinutes: thresholds.maxWalkMinutes })} />
          ) : null}
          {backgrounded && paused ? <StatusMessage tone="info" title={HM["hm.capture.background"]} /> : null}
          {paused && !backgrounded ? <StatusMessage tone="info" live={false} title={HM["hm.capture.paused"]} /> : null}
          {storageWarning ? (
            <p className="m-0 text-xs text-ink-secondary">
              This phone could not keep the recording in storage; it is held in memory for this session only.
            </p>
          ) : null}
          {submit.isError ? (
            <StatusMessage
              tone="danger"
              title={submit.error instanceof ApiError ? submit.error.message : HM["hm.capture.submitFailed"]}
              action={
                <Button variant="secondary" size="sm" onClick={() => submit.mutate()}>
                  {HM["hm.perm.retry"]}
                </Button>
              }
            />
          ) : null}

          <h1 className="m-0 text-base font-semibold sm:text-lg">{prompt}</h1>
          {stage === "outdoor_start" && !canStart && quality !== "off" ? (
            <p className="m-0 text-sm text-ink-secondary">{HM["hm.capture.waitingFix"]}</p>
          ) : null}
          {stage === "outdoor_end" && !canFinish && quality !== "off" ? (
            <p className="m-0 text-sm text-ink-secondary">{HM["hm.capture.waitingFix"]}</p>
          ) : null}
          {stage === "outdoor_start" ? (
            <p className="m-0 text-xs text-ink-secondary">
              {hm("hm.capture.maxLength", { maxMinutes: thresholds.maxWalkMinutes })} {HM["hm.capture.awake"]}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {sampleCount > 0 ? `${sampleCount} location readings recorded` : ""}
          </p>

          <div className="flex flex-wrap gap-3">
            {stage === "outdoor_start" ? (
              <>
                <Button block disabled={!canStart || Boolean(cameraError)} onClick={beginRecording}>
                  {HM["hm.capture.outsideStart.cta"]}
                </Button>
                <Button variant="quiet" onClick={() => setStopOpen(true)}>
                  {HM["hm.capture.stop"]}
                </Button>
              </>
            ) : null}
            {stage === "turn" ? (
              <>
                <Button block onClick={() => setStage("indoor")}>
                  {HM["hm.capture.walkIn"]}
                </Button>
                <Button variant="secondary" onClick={togglePause}>
                  {paused ? HM["hm.capture.resume"] : HM["hm.capture.pause"]}
                </Button>
              </>
            ) : null}
            {stage === "indoor" ? (
              <>
                <Button block onClick={() => setStage("outdoor_end")}>
                  {HM["hm.capture.finishOutside"]}
                </Button>
                <Button variant="secondary" onClick={togglePause}>
                  {paused ? HM["hm.capture.resume"] : HM["hm.capture.pause"]}
                </Button>
                <Button variant="quiet" onClick={() => setStopOpen(true)}>
                  {HM["hm.capture.stop"]}
                </Button>
              </>
            ) : null}
            {stage === "outdoor_end" ? (
              <>
                <Button block disabled={!canFinish} onClick={finishWalk}>
                  {HM["hm.capture.outsideEnd.cta"]}
                </Button>
                <Button variant="quiet" onClick={() => setStopOpen(true)}>
                  {HM["hm.capture.stop"]}
                </Button>
              </>
            ) : null}
            {stage === "finishing" ? (
              <Button block busy={submit.isPending} busyLabel={HM["hm.capture.submitting"]} disabled>
                {HM["hm.capture.submitting"]}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        title={HM["hm.capture.stop.title"]}
        description={HM["hm.capture.stop.body"]}
        size="sm"
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" busy={discard.isPending} busyLabel="Deleting…" onClick={() => discard.mutate()}>
            {HM["hm.capture.stop.confirm"]}
          </Button>
          <Button variant="secondary" onClick={() => setStopOpen(false)}>
            {HM["hm.capture.stop.cancel"]}
          </Button>
        </div>
        {discard.isError ? (
          <div className="mt-4">
            <StatusMessage tone="danger" title="We couldn't delete that walk. Please try again." />
          </div>
        ) : null}
      </Dialog>
    </Shell>
  );
}

/** Three ink bars: none, rough, good. The text beside it is the meaning. */
function FixMeter({ quality }: { quality: FixQuality }) {
  const lit = quality === "good" ? 3 : quality === "rough" ? 1 : 0;
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={`w-1.5 rounded-sm ${bar <= lit ? "bg-brand" : "bg-divider"}`}
          style={{ height: `${6 + bar * 4}px` }}
        />
      ))}
    </span>
  );
}
