/**
 * On-device keeping of a walk (HM-01, HM-02).
 *
 * The recording never passes through the API. It is kept here, in the
 * browser's IndexedDB, keyed by scan id — video chunks as they arrive from
 * the recorder, and the location record as it grows — until the hub on this
 * same phone uploads it straight to the bucket and the server records the
 * complete package. Every function rejects when storage is unavailable;
 * callers treat that as "kept in memory only" and say so, never as
 * verification.
 */
import type { ScanLocationSample } from "./types";

const DB_NAME = "stead-honesty-scan";
const DB_VERSION = 1;
const CHUNKS = "chunks";
const META = "meta";

export type ScanMeta = {
  scanId: string;
  mimeType: string | null;
  samples: ScanLocationSample[];
  chunkCount: number;
  updatedAt: string;
  /** Set when the walk finished (HM-02): what the upload declares. */
  durationMs?: number | null;
  clientEnvironment?: Record<string, string | number | boolean>;
};

export type StoredChunk = { seq: number; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: ["scanId", "seq"] });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "scanId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open scan storage"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Scan storage write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Scan storage write aborted"));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Scan storage read failed"));
  });
}

export async function putChunk(scanId: string, seq: number, blob: Blob): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(CHUNKS, "readwrite");
    tx.objectStore(CHUNKS).put({ scanId, seq, blob });
    await done(tx);
  } finally {
    db.close();
  }
}

export async function putMeta(meta: ScanMeta): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(meta);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function readMeta(scanId: string): Promise<ScanMeta | null> {
  const db = await open();
  try {
    const tx = db.transaction(META, "readonly");
    const found = await result(tx.objectStore(META).get(scanId) as IDBRequest<ScanMeta | undefined>);
    return found ?? null;
  } finally {
    db.close();
  }
}

/** Every chunk of one scan, in recorder order. Blobs are handles, not bytes in memory. */
export async function listChunks(scanId: string): Promise<StoredChunk[]> {
  const db = await open();
  try {
    const tx = db.transaction(CHUNKS, "readonly");
    const range = IDBKeyRange.bound([scanId, 0], [scanId, Number.MAX_SAFE_INTEGER]);
    const rows = await result(
      tx.objectStore(CHUNKS).getAll(range) as IDBRequest<{ scanId: string; seq: number; blob: Blob }[]>,
    );
    return rows.map((r) => ({ seq: r.seq, blob: r.blob })).sort((a, b) => a.seq - b.seq);
  } finally {
    db.close();
  }
}

export async function countChunks(scanId: string): Promise<number> {
  const db = await open();
  try {
    const tx = db.transaction(CHUNKS, "readonly");
    const range = IDBKeyRange.bound([scanId, 0], [scanId, Number.MAX_SAFE_INTEGER]);
    return await result(tx.objectStore(CHUNKS).count(range));
  } finally {
    db.close();
  }
}

export async function clearScan(scanId: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([CHUNKS, META], "readwrite");
    const range = IDBKeyRange.bound([scanId, 0], [scanId, Number.MAX_SAFE_INTEGER]);
    tx.objectStore(CHUNKS).delete(range);
    tx.objectStore(META).delete(scanId);
    await done(tx);
  } finally {
    db.close();
  }
}
