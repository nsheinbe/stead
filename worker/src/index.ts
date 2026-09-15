/**
 * HM-03 — the reconstruction worker's loop.
 *
 *   claim → reconstruct (worker/src/pipeline.ts) → finish
 *
 * Runs anywhere Node, ffmpeg, COLMAP, Nerfstudio and splat-transform are
 * installed (worker/README.md). It talks to Stead over HTTP with
 * SCAN_WORKER_SECRET and to the bucket with the S3_* credentials; it never
 * holds a database connection string.
 *
 *   SCAN_WORKER_ONCE=1          process at most one job, then exit
 *   SCAN_WORKER_POLL_SECONDS    how long to wait when the queue is empty (default 60)
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { workerApi } from "./api";
import { DEFAULT_TOOLS, reconstruct, type Adapters, type Command, type ToolConfig } from "./pipeline";

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const api = workerApi(need("STEAD_API_URL"), need("SCAN_WORKER_SECRET"));
const workerId = process.env.SCAN_WORKER_ID ?? `worker-${process.pid}`;
const bucketName = need("S3_BUCKET");
const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: { accessKeyId: need("S3_ACCESS_KEY_ID"), secretAccessKey: need("S3_SECRET_ACCESS_KEY") },
});

const tools: ToolConfig = {
  ...DEFAULT_TOOLS,
  nsProcessData: process.env.SCAN_TOOL_NS_PROCESS_DATA ?? DEFAULT_TOOLS.nsProcessData,
  nsTrain: process.env.SCAN_TOOL_NS_TRAIN ?? DEFAULT_TOOLS.nsTrain,
  nsExport: process.env.SCAN_TOOL_NS_EXPORT ?? DEFAULT_TOOLS.nsExport,
  splatTransform: process.env.SCAN_TOOL_SPLAT_TRANSFORM ?? DEFAULT_TOOLS.splatTransform,
  trainIterations: Number(process.env.SCAN_TRAIN_ITERATIONS ?? DEFAULT_TOOLS.trainIterations),
};

function log(line: string): void {
  console.log(`[scan-worker ${new Date().toISOString()}] ${line}`);
}

function run(command: Command): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let tail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command.stage} exited ${code}: ${tail.split("\n").filter(Boolean).at(-1) ?? ""}`));
    });
  });
}

const adapters: Adapters = {
  async download(key, toPath) {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    if (!object.Body) throw new Error(`empty object ${key}`);
    await pipeline(object.Body as Readable, createWriteStream(toPath));
  },
  async upload(fromPath, key, contentType) {
    const body = await readFile(fromPath);
    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }));
    return { sizeBytes: body.byteLength };
  },
  run,
  async listFiles(dir) {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort();
  },
  async fileSize(path) {
    return (await stat(path)).size;
  },
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, text) => writeFile(path, text, "utf8"),
  log,
};

async function once(): Promise<boolean> {
  const job = await api.claim(workerId);
  if (!job) return false;
  log(`claimed scan ${job.scanId} (attempt ${job.attempt})`);
  const root = await mkdtemp(join(tmpdir(), "stead-scan-"));
  try {
    const result = await reconstruct(job, { root }, adapters, tools);
    const done = await api.finish(job.scanId, result.finish);
    log(`scan ${job.scanId}: ${result.finish.outcome} after ${result.stagesDone.join(" → ") || "nothing"}; server says ${done.state}`);
  } finally {
    // The home's footage never outlives the job on this machine.
    await rm(root, { recursive: true, force: true });
  }
  return true;
}

const pollSeconds = Number(process.env.SCAN_WORKER_POLL_SECONDS ?? 60);
const onceOnly = process.env.SCAN_WORKER_ONCE === "1";

(async () => {
  log(`starting as ${workerId}`);
  for (;;) {
    let worked = false;
    try {
      worked = await once();
    } catch (err) {
      log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (onceOnly) break;
    if (!worked) await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
})();
