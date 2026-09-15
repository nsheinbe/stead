/**
 * The upload of a located walk (HM-02), as a state machine the page drives.
 *
 * Why it lives here and not in the component: everything that decides what
 * happens next — grouping chunks into parts, what to do when a part's
 * receipt comes back wrong, when to stop, when to resume — is testable with
 * fakes, and the page only renders the snapshot. Every fact the page shows
 * about progress is the server's: a part counts as sent when the server
 * confirms it, never when the PUT returned.
 *
 * The plan is deterministic in the chunk list. Chunk sizes never change once
 * recorded, so a resumed upload declares the same parts with the same sizes
 * and the server accepts the declaration as a resume.
 */
import type {
  HostScan,
  ScanUploadConfirmResponse,
  ScanUploadDeclareRequest,
  ScanUploadDeclareResponse,
  ScanUploadPresignResponse,
} from "./types";
import type { ScanMeta, StoredChunk } from "./scanStore";

/** About 8 MB per part: big enough to be few, small enough to retry cheaply. */
export const PART_TARGET_BYTES = 8 * 1024 * 1024;
/** Parts presigned and confirmed together. */
export const PART_BATCH_SIZE = 5;
/** Put attempts per part before the upload stops and waits for Resume. */
export const PUT_ATTEMPTS = 3;
/** Times a part may come back unconfirmed (wrong size) before the upload stops. */
export const MISMATCH_ATTEMPTS = 3;

export type ChunkSize = { seq: number; size: number };
export type PartPlan = { seq: number; chunkSeqs: number[]; bytes: number };

/**
 * Group recorder chunks, in order, into parts of about `target` bytes. A
 * chunk never splits, a part never has zero bytes, and the last part takes
 * the remainder. Empty chunks are dropped.
 */
export function planParts(chunks: readonly ChunkSize[], target = PART_TARGET_BYTES): PartPlan[] {
  const ordered = [...chunks].filter((c) => c.size > 0).sort((a, b) => a.seq - b.seq);
  const parts: PartPlan[] = [];
  let current: PartPlan | null = null;
  for (const chunk of ordered) {
    if (!current || current.bytes >= target) {
      current = { seq: parts.length, chunkSeqs: [], bytes: 0 };
      parts.push(current);
    }
    current.chunkSeqs.push(chunk.seq);
    current.bytes += chunk.size;
  }
  return parts;
}

/** "845 MB", "1.2 GB". Sizes on screen, never bytes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(bytes >= 10_000_000_000 ? 0 : 1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export type UploadPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "completing"
  | "done"
  | "paused"
  | "offline"
  | "stopped"
  | "too_large"
  | "unconfigured"
  | "missing";

export type UploadSnapshot = {
  phase: UploadPhase;
  totalParts: number;
  confirmedParts: number;
  totalBytes: number;
  /** Confirmed bytes plus the in-flight part's progress. */
  sentBytes: number;
  /** The server's sentence when the upload stopped or was refused. */
  message: string | null;
  /** How many receipts came back wrong and were sent again. */
  mismatches: number;
  /** Why the upload is `stopped`: a part that would not arrive, a receipt that kept coming back wrong, or a refusal. */
  stopReason: "put" | "mismatch" | "api" | null;
  /** The hub after the server recorded the complete package. */
  hub: HostScan | null;
};

export type UploaderDeps = {
  readMeta: () => Promise<ScanMeta | null>;
  listChunks: () => Promise<StoredChunk[]>;
  clearScan: () => Promise<void>;
  declare: (body: ScanUploadDeclareRequest) => Promise<ScanUploadDeclareResponse>;
  presign: (seqs: number[]) => Promise<ScanUploadPresignResponse>;
  confirm: (seqs: number[]) => Promise<ScanUploadConfirmResponse>;
  complete: () => Promise<HostScan>;
  put: (
    url: string,
    body: Blob,
    contentType: string,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  isOnline: () => boolean;
  /** Status of an API failure, if it was one. Lets the machine tell 413 and 503 apart. */
  statusOf: (err: unknown) => number | null;
  sleep?: (ms: number) => Promise<void>;
  partTargetBytes?: number;
  batchSize?: number;
};

export type ScanUploader = {
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  snapshot: () => UploadSnapshot;
};

class Paused extends Error {}
class Offline extends Error {}
class Stopped extends Error {
  constructor(
    readonly reason: "put" | "mismatch",
    message: string | null,
  ) {
    super(message ?? "The upload stopped");
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createScanUploader(deps: UploaderDeps, onChange: (snapshot: UploadSnapshot) => void): ScanUploader {
  const sleep = deps.sleep ?? defaultSleep;
  const batchSize = deps.batchSize ?? PART_BATCH_SIZE;
  let state: UploadSnapshot = {
    phase: "idle",
    totalParts: 0,
    confirmedParts: 0,
    totalBytes: 0,
    sentBytes: 0,
    message: null,
    mismatches: 0,
    stopReason: null,
    hub: null,
  };
  let running = false;
  let paused = false;
  let controller: AbortController | null = null;

  const set = (patch: Partial<UploadSnapshot>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const checkpoint = () => {
    if (paused) throw new Paused();
    if (!deps.isOnline()) throw new Offline();
  };

  async function putWithRetries(url: string, body: Blob, contentType: string, confirmedBytes: number) {
    for (let attempt = 1; ; attempt += 1) {
      checkpoint();
      controller = new AbortController();
      try {
        await deps.put(url, body, contentType, (sent) => set({ sentBytes: confirmedBytes + sent }), controller.signal);
        return;
      } catch (err) {
        if (paused) throw new Paused();
        if (!deps.isOnline()) throw new Offline();
        if (attempt >= PUT_ATTEMPTS) throw new Stopped("put", err instanceof Error ? err.message : null);
        await sleep(1000 * 2 ** (attempt - 1));
      } finally {
        controller = null;
      }
    }
  }

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    paused = false;
    try {
      set({ phase: "preparing", message: null, stopReason: null, hub: null });
      const [meta, chunks] = await Promise.all([deps.readMeta(), deps.listChunks()]);
      const plan = planParts(chunks.map((c) => ({ seq: c.seq, size: c.blob.size })), deps.partTargetBytes);
      if (!meta?.mimeType || plan.length === 0) {
        set({ phase: "missing" });
        return;
      }
      const blobs = new Map(chunks.map((c) => [c.seq, c.blob]));
      const totalBytes = plan.reduce((sum, p) => sum + p.bytes, 0);
      set({ totalParts: plan.length, totalBytes });
      checkpoint();

      let declared: ScanUploadDeclareResponse;
      try {
        declared = await deps.declare({
          mimeType: meta.mimeType,
          durationMs: meta.durationMs ?? 0,
          clientEnvironment: meta.clientEnvironment ?? {},
          parts: plan.map((p) => ({ seq: p.seq, bytes: p.bytes })),
        });
      } catch (err) {
        const status = deps.statusOf(err);
        const message = err instanceof Error ? err.message : null;
        if (status === 413) {
          set({ phase: "too_large", message });
          return;
        }
        if (status === 503) {
          set({ phase: "unconfigured", message });
          return;
        }
        if (status !== null) {
          set({ phase: "stopped", stopReason: "api", message });
          return;
        }
        throw err;
      }

      const confirmed = new Set(declared.parts.filter((p) => p.confirmed).map((p) => p.seq));
      const bySeq = new Map(plan.map((p) => [p.seq, p]));
      let confirmedBytes = plan.filter((p) => confirmed.has(p.seq)).reduce((sum, p) => sum + p.bytes, 0);
      set({ phase: "uploading", confirmedParts: confirmed.size, sentBytes: confirmedBytes });

      const pending = plan.filter((p) => !confirmed.has(p.seq)).map((p) => p.seq);
      const attempts = new Map<number, number>();
      let mismatches = state.mismatches;

      while (pending.length > 0) {
        checkpoint();
        const batch = pending.splice(0, batchSize);
        const { uploads } = await deps.presign(batch);
        const byUpload = new Map(uploads.map((u) => [u.seq, u]));
        for (const seq of batch) {
          const upload = byUpload.get(seq);
          const part = bySeq.get(seq)!;
          // Already confirmed on the server: nothing to send, the confirm will say so.
          if (!upload) continue;
          const body = new Blob(part.chunkSeqs.map((s) => blobs.get(s)!), { type: upload.contentType });
          await putWithRetries(upload.uploadUrl, body, upload.contentType, confirmedBytes);
        }
        checkpoint();
        const { results } = await deps.confirm(batch);
        const retry: number[] = [];
        for (const seq of batch) {
          const result = results.find((r) => r.seq === seq);
          if (result?.confirmed) {
            confirmed.add(seq);
            confirmedBytes += bySeq.get(seq)!.bytes;
            continue;
          }
          // The bytes in the bucket are not the bytes that left. Send again;
          // the key is the same, so the object is simply overwritten.
          const n = (attempts.get(seq) ?? 0) + 1;
          attempts.set(seq, n);
          mismatches += 1;
          set({ confirmedParts: confirmed.size, sentBytes: confirmedBytes, mismatches });
          if (n >= MISMATCH_ATTEMPTS) throw new Stopped("mismatch", null);
          retry.push(seq);
        }
        pending.unshift(...retry);
        set({ confirmedParts: confirmed.size, sentBytes: confirmedBytes, mismatches });
      }

      checkpoint();
      set({ phase: "completing" });
      const hub = await deps.complete();
      set({ phase: "done", hub, sentBytes: totalBytes, confirmedParts: plan.length });
      await deps.clearScan().catch(() => undefined);
    } catch (err) {
      if (err instanceof Paused || paused) {
        set({ phase: "paused" });
      } else if (err instanceof Offline || !deps.isOnline()) {
        set({ phase: "offline" });
      } else if (err instanceof Stopped) {
        set({ phase: "stopped", stopReason: err.reason, message: err.reason === "put" ? err.message : null });
      } else {
        const status = deps.statusOf(err);
        set({
          phase: "stopped",
          stopReason: status !== null ? "api" : "put",
          message: err instanceof Error ? err.message : null,
        });
      }
    } finally {
      running = false;
    }
  }

  return {
    start: run,
    pause: () => {
      if (!running) return;
      paused = true;
      controller?.abort();
    },
    resume: async () => {
      paused = false;
      await run();
    },
    snapshot: () => state,
  };
}

/** The browser PUT, with progress. Not for tests; the machine takes it as a dep. */
export function xhrPut(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (sentBytes: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload returned ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
