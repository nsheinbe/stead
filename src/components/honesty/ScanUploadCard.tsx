import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { HM, hm } from "../../lib/honesty";
import { clearScan, listChunks, readMeta } from "../../lib/scanStore";
import {
  createScanUploader,
  formatBytes,
  xhrPut,
  type ScanUploader,
  type UploadSnapshot,
} from "../../lib/scanUploader";
import type { HostScan, HostScanRow, ScanUploadLimits } from "../../lib/types";
import { Button, Card, DataList, DataRow, StatusMessage } from "../ui";

/**
 * The Uploading state of the hub (HM-D03), on the phone that recorded.
 *
 * Starts on its own: the walk has passed its location check, the recording
 * is in this browser, and the only thing left is to move it. Everything the
 * card says about progress is what the server confirmed; the bar moves with
 * the bytes in flight but the count moves only on receipts.
 */
export function ScanUploadCard({
  listingId,
  scan,
  limits,
  storageConfigured,
  onUploaded,
}: {
  listingId: string;
  scan: HostScanRow;
  limits: ScanUploadLimits;
  storageConfigured: boolean;
  onUploaded: (hub: HostScan) => void;
}) {
  const uploaderRef = useRef<ScanUploader | null>(null);
  const [snapshot, setSnapshot] = useState<UploadSnapshot | null>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  useEffect(() => {
    if (!storageConfigured) return;
    const scanId = scan.id;
    const uploader: ScanUploader = createScanUploader(
      {
        readMeta: () => readMeta(scanId),
        listChunks: () => listChunks(scanId),
        clearScan: () => clearScan(scanId),
        declare: (body) => api.declareScanUpload(listingId, scanId, body),
        presign: (seqs) => api.presignScanUpload(listingId, scanId, seqs),
        confirm: (seqs) => api.confirmScanUpload(listingId, scanId, seqs),
        complete: () => api.completeScanUpload(listingId, scanId),
        put: xhrPut,
        isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
        statusOf: (err) => (err instanceof ApiError ? err.status : null),
      },
      (next) => {
        // StrictMode mounts twice; a paused first uploader must not speak over the live one.
        if (uploaderRef.current !== uploader) return;
        setSnapshot(next);
        if (next.phase === "done" && next.hub) onUploadedRef.current(next.hub);
      },
    );
    uploaderRef.current = uploader;
    void uploader.start();

    const onOnline = () => {
      if (uploader.snapshot().phase === "offline") void uploader.resume();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      uploader.pause();
      uploaderRef.current = null;
    };
  }, [listingId, scan.id, storageConfigured]);

  if (!storageConfigured) {
    return (
      <Card as="section" aria-labelledby="scan-state">
        <h2 id="scan-state" className="m-0 text-card-title">
          {HM["hm.upload.unconfigured.title"]}
        </h2>
        <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.upload.unconfigured.body"]}</p>
      </Card>
    );
  }

  const phase = snapshot?.phase ?? "preparing";
  const total = snapshot?.totalBytes ?? 0;
  const sent = Math.min(snapshot?.sentBytes ?? 0, total);
  const percent = total > 0 ? Math.floor((sent / total) * 100) : 0;
  const active = phase === "uploading" || phase === "preparing" || phase === "completing";
  const videoValue =
    phase === "preparing"
      ? HM["hm.upload.preparing"]
      : snapshot
        ? `${snapshot.confirmedParts} of ${snapshot.totalParts} parts`
        : "";

  return (
    <Card as="section" aria-labelledby="scan-state">
      <h2 id="scan-state" className="m-0 text-card-title">
        {HM["hm.upload.title"]}
      </h2>
      <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.upload.body"]}</p>

      {total > 0 ? (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-label={HM["hm.upload.title"]}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full overflow-hidden rounded-full bg-control"
          >
            <div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="money mb-0 mt-2 text-sm text-ink-secondary" aria-live="polite">
            {hm("hm.upload.progress", { done: formatBytes(sent), total: formatBytes(total) })}
          </p>
        </div>
      ) : null}

      <DataList className="mt-4">
        <DataRow label={HM["hm.upload.group.video"]} value={videoValue} />
        <DataRow label={HM["hm.upload.group.location"]} value={HM["hm.upload.group.location.done"]} />
        <DataRow
          label={HM["hm.upload.group.details"]}
          value={phase === "completing" ? HM["hm.upload.completing"] : HM["hm.upload.group.details.pending"]}
        />
      </DataList>

      {phase === "paused" ? (
        <p className="mb-0 mt-3 text-sm text-ink-secondary" role="status">
          {HM["hm.upload.paused"]}
        </p>
      ) : null}
      {phase === "offline" ? (
        <div className="mt-3">
          <StatusMessage tone="info" title={HM["hm.upload.offline"]} />
        </div>
      ) : null}
      {phase === "stopped" ? (
        <div className="mt-3">
          {snapshot?.stopReason === "mismatch" ? (
            <StatusMessage tone="warning" title={HM["hm.upload.mismatch.title"]}>
              <p>{HM["hm.upload.mismatch.body"]}</p>
            </StatusMessage>
          ) : (
            <StatusMessage tone="warning" title={HM["hm.upload.stopped.title"]}>
              <p>{snapshot?.stopReason === "api" && snapshot.message ? snapshot.message : HM["hm.upload.stopped.body"]}</p>
            </StatusMessage>
          )}
        </div>
      ) : null}
      {phase === "too_large" ? (
        <div className="mt-3">
          <StatusMessage tone="danger" title={HM["hm.upload.tooLarge.title"]}>
            <p>
              {hm("hm.upload.tooLarge.body", {
                size: formatBytes(total),
                limit: formatBytes(limits.maxUploadBytes),
                maxMinutes: scan.thresholds.maxWalkMinutes,
              })}
            </p>
          </StatusMessage>
        </div>
      ) : null}
      {phase === "unconfigured" ? (
        <div className="mt-3">
          <StatusMessage tone="info" title={HM["hm.upload.unconfigured.title"]}>
            <p>{HM["hm.upload.unconfigured.body"]}</p>
          </StatusMessage>
        </div>
      ) : null}
      {snapshot && snapshot.mismatches > 0 && phase !== "stopped" ? (
        <div className="mt-3">
          <StatusMessage tone="info" title={HM["hm.upload.mismatch.title"]}>
            <p>{HM["hm.upload.mismatch.body"]}</p>
          </StatusMessage>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {active ? (
          <Button variant="secondary" onClick={() => uploaderRef.current?.pause()} disabled={phase !== "uploading"}>
            {HM["hm.upload.pause"]}
          </Button>
        ) : phase === "paused" || phase === "stopped" || phase === "offline" ? (
          <Button onClick={() => void uploaderRef.current?.resume()}>{HM["hm.upload.resume"]}</Button>
        ) : null}
      </div>
    </Card>
  );
}
