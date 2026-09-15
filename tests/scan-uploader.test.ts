/**
 * HM-02. The upload machine, driven with fakes.
 *
 * What these prove: chunks group into parts deterministically, so a resumed
 * upload declares the same package; a part counts only when the server
 * confirms it; a wrong receipt is sent again and then stops the upload
 * rather than being papered over; pause, offline and resume do what the
 * copy says; and the server's refusals (too large, no storage) land on the
 * right card.
 */
import { describe, expect, it } from "vitest";
import {
  createScanUploader,
  formatBytes,
  MISMATCH_ATTEMPTS,
  planParts,
  PUT_ATTEMPTS,
  type UploaderDeps,
  type UploadSnapshot,
} from "../src/lib/scanUploader";
import type { ScanMeta } from "../src/lib/scanStore";
import type { HostScan } from "../src/lib/types";

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

describe("planParts", () => {
  it("groups chunks in order into parts of about the target size", () => {
    const chunks = Array.from({ length: 10 }, (_, seq) => ({ seq, size: 3 }));
    const parts = planParts(chunks, 7);
    expect(parts.map((p) => p.chunkSeqs)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
    expect(parts.map((p) => p.bytes)).toEqual([9, 9, 9, 3]);
    expect(parts.map((p) => p.seq)).toEqual([0, 1, 2, 3]);
  });

  it("never splits a chunk, drops empty ones, and is stable across calls", () => {
    const chunks = [
      { seq: 2, size: 20 },
      { seq: 0, size: 0 },
      { seq: 1, size: 5 },
    ];
    // A part fills until it reaches the target, so a big chunk rides with a small one.
    const first = planParts(chunks, 8);
    expect(first).toEqual([{ seq: 0, chunkSeqs: [1, 2], bytes: 25 }]);
    expect(planParts(chunks, 5)).toEqual([
      { seq: 0, chunkSeqs: [1], bytes: 5 },
      { seq: 1, chunkSeqs: [2], bytes: 20 },
    ]);
    expect(planParts([...chunks].reverse(), 8)).toEqual(first);
    expect(planParts([], 8)).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("shows sizes the way a person reads them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(84_000)).toBe("84 KB");
    expect(formatBytes(845_000_000)).toBe("845 MB");
    expect(formatBytes(1_250_000_000)).toBe("1.3 GB");
    expect(formatBytes(12_000_000_000)).toBe("12 GB");
  });
});

/** A recording of 6 chunks of 4 bytes, planned into 3 parts of 8. */
function harness(options: {
  confirmedOnDeclare?: number[];
  putFailures?: Record<string, number>;
  headSizes?: (seq: number, attempt: number) => number;
  declareError?: FakeApiError;
  online?: () => boolean;
  onConfirm?: (seqs: number[]) => void;
} = {}) {
  const chunks = Array.from({ length: 6 }, (_, seq) => ({ seq, blob: new Blob([new Uint8Array(4)]) }));
  const meta: ScanMeta = {
    scanId: "scan-1",
    mimeType: "video/webm;codecs=vp9",
    samples: [],
    chunkCount: 6,
    updatedAt: "2026-09-15T14:00:00Z",
    durationMs: 12_000,
    clientEnvironment: { userAgent: "test" },
  };
  const calls: string[] = [];
  const snapshots: UploadSnapshot[] = [];
  const confirmed = new Set(options.confirmedOnDeclare ?? []);
  const confirmAttempts = new Map<number, number>();
  const putAttempts = new Map<string, number>();
  const putBodies = new Map<string, number>();
  const hub = { scan: { state: "uploaded" } } as unknown as HostScan;
  let cleared = false;

  const deps: UploaderDeps = {
    readMeta: async () => meta,
    listChunks: async () => chunks,
    clearScan: async () => {
      cleared = true;
    },
    declare: async (body) => {
      calls.push(`declare:${body.parts.map((p) => `${p.seq}=${p.bytes}`).join(",")}`);
      if (options.declareError) throw options.declareError;
      return {
        parts: body.parts.map((p) => ({ ...p, confirmed: confirmed.has(p.seq) })),
        limits: { maxUploadBytes: 1000, maxPartBytes: 100, maxParts: 10 },
      };
    },
    presign: async (seqs) => {
      calls.push(`presign:${seqs.join(",")}`);
      return {
        uploads: seqs
          .filter((seq) => !confirmed.has(seq))
          .map((seq) => ({ seq, uploadUrl: `https://bucket/part-${seq}`, contentType: "video/webm", expiresInSeconds: 300 })),
      };
    },
    confirm: async (seqs) => {
      calls.push(`confirm:${seqs.join(",")}`);
      options.onConfirm?.(seqs);
      return {
        results: seqs.map((seq) => {
          const attempt = (confirmAttempts.get(seq) ?? 0) + 1;
          confirmAttempts.set(seq, attempt);
          const size = options.headSizes ? options.headSizes(seq, attempt) : 8;
          const ok = size === 8;
          if (ok) confirmed.add(seq);
          return { seq, confirmed: ok, bytes: size };
        }),
      };
    },
    complete: async () => {
      calls.push("complete");
      return hub;
    },
    put: async (url, body, contentType, onProgress, signal) => {
      const n = (putAttempts.get(url) ?? 0) + 1;
      putAttempts.set(url, n);
      putBodies.set(url, body.size);
      calls.push(`put:${url.split("-").pop()}#${n}:${contentType}`);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if ((options.putFailures?.[url] ?? 0) >= n) throw new Error("socket closed");
      onProgress(body.size);
    },
    isOnline: options.online ?? (() => true),
    statusOf: (err) => (err instanceof FakeApiError ? err.status : null),
    sleep: async () => undefined,
    partTargetBytes: 8,
    batchSize: 2,
  };
  const uploader = createScanUploader(deps, (s) => snapshots.push(s));
  return { uploader, calls, snapshots, putBodies, isCleared: () => cleared, hub };
}

describe("the upload machine", () => {
  it("declares, sends, confirms in batches, completes, and clears the phone", async () => {
    const h = harness();
    await h.uploader.start();
    expect(h.calls).toEqual([
      "declare:0=8,1=8,2=8",
      "presign:0,1",
      "put:0#1:video/webm",
      "put:1#1:video/webm",
      "confirm:0,1",
      "presign:2",
      "put:2#1:video/webm",
      "confirm:2",
      "complete",
    ]);
    // Each part is the concatenation of its chunks, typed as the signed content type.
    expect([...h.putBodies.values()]).toEqual([8, 8, 8]);
    const last = h.uploader.snapshot();
    expect(last.phase).toBe("done");
    expect(last.confirmedParts).toBe(3);
    expect(last.sentBytes).toBe(24);
    expect(last.hub).toBe(h.hub);
    expect(h.isCleared()).toBe(true);
    // The count only ever moves on receipts, never on a returned PUT.
    const afterPuts = h.snapshots.filter((s) => s.phase === "uploading").map((s) => s.confirmedParts);
    expect(afterPuts[0]).toBe(0);
    expect(Math.max(...afterPuts)).toBe(3);
  });

  it("resumes by skipping what the server already confirmed", async () => {
    const h = harness({ confirmedOnDeclare: [0, 1] });
    await h.uploader.start();
    expect(h.calls).toEqual(["declare:0=8,1=8,2=8", "presign:2", "put:2#1:video/webm", "confirm:2", "complete"]);
    expect(h.snapshots.find((s) => s.phase === "uploading")?.sentBytes).toBe(16);
  });

  it("sends a part again when its receipt is wrong, then stops rather than pretends", async () => {
    const once = harness({ headSizes: (seq, attempt) => (seq === 1 && attempt === 1 ? 7 : 8) });
    await once.uploader.start();
    expect(once.calls.filter((c) => c.startsWith("put:1")).length).toBe(2);
    expect(once.uploader.snapshot().phase).toBe("done");
    expect(once.uploader.snapshot().mismatches).toBe(1);

    const always = harness({ headSizes: (seq) => (seq === 1 ? 7 : 8) });
    await always.uploader.start();
    const last = always.uploader.snapshot();
    expect(last.phase).toBe("stopped");
    expect(last.stopReason).toBe("mismatch");
    expect(last.mismatches).toBe(MISMATCH_ATTEMPTS);
    expect(always.calls).not.toContain("complete");
    expect(always.isCleared()).toBe(false);
  });

  it("retries a failed PUT with backoff and then stops, keeping the recording", async () => {
    const h = harness({ putFailures: { "https://bucket/part-0": PUT_ATTEMPTS } });
    await h.uploader.start();
    expect(h.calls.filter((c) => c.startsWith("put:0")).length).toBe(PUT_ATTEMPTS);
    expect(h.uploader.snapshot().phase).toBe("stopped");
    expect(h.uploader.snapshot().stopReason).toBe("put");
    expect(h.isCleared()).toBe(false);

    const flaky = harness({ putFailures: { "https://bucket/part-0": PUT_ATTEMPTS - 1 } });
    await flaky.uploader.start();
    expect(flaky.uploader.snapshot().phase).toBe("done");
  });

  it("lands the server's refusals on the right card", async () => {
    const big = harness({ declareError: new FakeApiError(413, "This walk is larger than we can accept.") });
    await big.uploader.start();
    expect(big.uploader.snapshot().phase).toBe("too_large");
    expect(big.uploader.snapshot().message).toBe("This walk is larger than we can accept.");

    const none = harness({ declareError: new FakeApiError(503, "Uploads aren't set up on this deployment yet.") });
    await none.uploader.start();
    expect(none.uploader.snapshot().phase).toBe("unconfigured");

    const closed = harness({ declareError: new FakeApiError(409, "That walk is no longer the current one.") });
    await closed.uploader.start();
    expect(closed.uploader.snapshot().phase).toBe("stopped");
    expect(closed.uploader.snapshot().stopReason).toBe("api");
    expect(closed.uploader.snapshot().message).toBe("That walk is no longer the current one.");
  });

  it("waits while offline and picks up where it was on resume", async () => {
    let online = false;
    const h = harness({ online: () => online });
    await h.uploader.start();
    expect(h.uploader.snapshot().phase).toBe("offline");
    expect(h.calls).toEqual([]);

    online = true;
    await h.uploader.resume();
    expect(h.uploader.snapshot().phase).toBe("done");
  });

  it("pauses between parts and resumes without resending confirmed ones", async () => {
    // The host taps Pause while the first batch's receipts are coming back.
    let pauseNow = () => undefined as void;
    const h = harness({ onConfirm: (seqs) => (seqs[0] === 0 ? pauseNow() : undefined) });
    pauseNow = () => h.uploader.pause();
    await h.uploader.start();
    expect(h.uploader.snapshot().phase).toBe("paused");
    expect(h.uploader.snapshot().confirmedParts).toBe(2);
    expect(h.calls).not.toContain("complete");

    const before = h.calls.length;
    await h.uploader.resume();
    expect(h.uploader.snapshot().phase).toBe("done");
    // The resume re-declares (idempotent on the server) and only sends part 2.
    expect(h.calls.slice(before)).toEqual(["declare:0=8,1=8,2=8", "presign:2", "put:2#1:video/webm", "confirm:2", "complete"]);
  });

  it("says so when there is nothing on this phone to upload", async () => {
    const h = harness();
    const empty = createScanUploader(
      {
        readMeta: async () => null,
        listChunks: async () => [],
        clearScan: async () => undefined,
        declare: async () => {
          throw new Error("must not declare");
        },
        presign: async () => ({ uploads: [] }),
        confirm: async () => ({ results: [] }),
        complete: async () => h.hub,
        put: async () => undefined,
        isOnline: () => true,
        statusOf: () => null,
      },
      () => undefined,
    );
    await empty.start();
    expect(empty.snapshot().phase).toBe("missing");
  });
});
