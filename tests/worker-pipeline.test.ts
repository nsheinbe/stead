/**
 * HM-03 — the reconstruction pipeline, without COLMAP on the machine.
 *
 * Everything that touches the world is injected, so this checks the plan
 * and the runner's honesty: the stage list is fixed and names no generative
 * step or hard-avoid tool; stills go up before anything else can fail; a
 * failed stage is a `failed` outcome carrying what was saved, never a throw;
 * every key sits under the job's prefix; and the log never names a frame.
 */
import { describe, expect, it } from "vitest";
import type { ScanJob } from "../src/lib/types";
import { workerApi } from "../worker/src/api";
import {
  BANNED_TOOL_PATTERNS,
  DEFAULT_TOOLS,
  MAX_STILLS,
  STAGE_NAMES,
  outputKeys,
  pickStills,
  planCommands,
  planIsClean,
  reconstruct,
  type Adapters,
  type Command,
  type StageName,
} from "../worker/src/pipeline";

const LISTING = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";
const PREFIX = `listings/${LISTING}/scans/${SCAN}/`;

const job: ScanJob = {
  scanId: SCAN,
  listingId: LISTING,
  attempt: 2,
  timezone: "America/New_York",
  target: { lat: 42.2529, lng: -73.791 },
  thresholds: { accuracyMaxM: 35, geofenceRadiusM: 100 },
  inputs: {
    videoKey: `${PREFIX}video.mp4`,
    videoContentType: "video/mp4",
    attestationKey: `${PREFIX}attestation.json`,
    notesKey: `${PREFIX}notes.json`,
  },
  outputPrefix: PREFIX,
};

const ROOT = "/tmp/stead-scan-test";

function fakeAdapters(opts: { failAt?: StageName; frames?: number } = {}) {
  const uploads: { fromPath: string; key: string; contentType: string }[] = [];
  const downloads: { key: string; toPath: string }[] = [];
  const ran: string[] = [];
  const logs: string[] = [];
  const dirs = new Map<string, string[]>();
  const adapters: Adapters = {
    async download(key, toPath) {
      downloads.push({ key, toPath });
    },
    async upload(fromPath, key, contentType) {
      uploads.push({ fromPath, key, contentType });
      return { sizeBytes: key.length };
    },
    async run(command: Command) {
      if (command.stage === opts.failAt) throw new Error(`${command.command} exited 1\nlots of stderr`);
      ran.push(command.stage);
      if (command.stage === "extract") {
        const n = opts.frames ?? 240;
        dirs.set(
          `${ROOT}/processed/images`,
          Array.from({ length: n }, (_, i) => `frame_${String(i + 1).padStart(5, "0")}.jpg`),
        );
      }
    },
    async listFiles(dir) {
      return dirs.get(dir) ?? [];
    },
    async fileSize() {
      return 1;
    },
    async readText() {
      return "";
    },
    async writeText() {},
    log(line) {
      logs.push(line);
    },
  };
  return { adapters, uploads, downloads, ran, logs };
}

describe("the plan", () => {
  it("is the five honest stages and nothing else", () => {
    expect(STAGE_NAMES).toEqual(["extract", "stills", "train", "export", "compress"]);
    const stages = planCommands(job, { root: ROOT }).map((c) => c.stage);
    expect(stages).toEqual(["extract", "train", "export", "compress"]);
  });

  it("names no closed API, no non-commercial reference, and no generative step", () => {
    const commands = planCommands(job, { root: ROOT });
    expect(planIsClean(commands)).toEqual({ ok: true });
    for (const tool of Object.values(DEFAULT_TOOLS)) {
      for (const re of BANNED_TOOL_PATTERNS) expect(String(tool)).not.toMatch(re);
    }
    for (const bad of ["luma-cli", "dust3r", "mast3r", "OpenMVS", "gaussian-splatting", "inpaint-rooms", "generate-walls"]) {
      const result = planIsClean([{ stage: "train", command: bad, args: [] }]);
      expect(result.ok, bad).toBe(false);
    }
  });

  it("refuses to run a plan that names a banned tool", async () => {
    const { adapters } = fakeAdapters();
    await expect(
      reconstruct(job, { root: ROOT }, adapters, { ...DEFAULT_TOOLS, nsTrain: "luma-train" }),
    ).rejects.toThrow(/refusing to run/);
  });

  it("only reads the video: the location record and the notes are the host's", async () => {
    const { adapters, downloads } = fakeAdapters();
    await reconstruct(job, { root: ROOT }, adapters);
    expect(downloads.map((d) => d.key)).toEqual([`${PREFIX}video.mp4`]);
  });
});

describe("stills", () => {
  it("keeps every frame when there are few, and spreads at most eight when there are many", () => {
    expect(pickStills(["a.jpg", "b.jpg", "c.jpg"])).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    const many = Array.from({ length: 100 }, (_, i) => `f${String(i).padStart(3, "0")}.jpg`);
    const picked = pickStills(many);
    expect(picked).toHaveLength(MAX_STILLS);
    expect(picked[0]).toBe("f000.jpg");
    expect(picked[picked.length - 1]).toBe("f099.jpg");
    expect([...picked].sort()).toEqual(picked);
    expect(new Set(picked).size).toBe(picked.length);
    expect(pickStills(["notes.txt", "x.jpg"])).toEqual(["x.jpg"]);
  });

  it("go up before training, so a later failure still leaves the host frames", async () => {
    const { adapters, uploads, ran } = fakeAdapters({ failAt: "train" });
    const result = await reconstruct(job, { root: ROOT }, adapters);
    expect(result.finish.outcome).toBe("failed");
    if (result.finish.outcome !== "failed") throw new Error("unreachable");
    expect(result.finish.reason).toBe("reconstruction_failed");
    expect(result.finish.attempt).toBe(2);
    expect(result.stagesDone).toEqual(["extract", "stills"]);
    expect(ran).toEqual(["extract"]);
    const kinds = result.finish.artifacts.map((a) => a.kind);
    expect(kinds.filter((k) => k === "stills")).toHaveLength(MAX_STILLS);
    expect(kinds).toContain("frames");
    expect(kinds).toContain("cameras");
    expect(kinds).not.toContain("splat");
    expect(uploads.every((u) => u.key.startsWith(PREFIX))).toBe(true);
  });
});

describe("outcomes", () => {
  it("a whole run is needs_mask with a splat, a compressed splat, the cameras and the stills", async () => {
    const { adapters, ran, uploads } = fakeAdapters({ frames: 12 });
    const result = await reconstruct(job, { root: ROOT }, adapters);
    expect(ran).toEqual(["extract", "train", "export", "compress"]);
    expect(result.stagesDone).toEqual(["extract", "stills", "train", "export", "compress"]);
    expect(result.finish.outcome).toBe("needs_mask");
    expect(result.finish.attempt).toBe(2);
    const keys = outputKeys(job);
    const byKind = Object.fromEntries(result.finish.artifacts.map((a) => [a.kind, a.objectKey]));
    expect(byKind.splat).toBe(keys.splat);
    expect(byKind.splat_compressed).toBe(keys.splatCompressed);
    expect(byKind.cameras).toBe(keys.cameras);
    expect(byKind.frames).toBe(keys.frames);
    expect(result.finish.artifacts.filter((a) => a.kind === "stills").map((a) => a.objectKey)).toEqual(
      Array.from({ length: MAX_STILLS }, (_, i) => keys.still(i)),
    );
    expect(result.finish.artifacts.every((a) => a.objectKey.startsWith(PREFIX))).toBe(true);
    expect(result.finish.artifacts.every((a) => !a.objectKey.includes(".."))).toBe(true);
    expect(uploads.map((u) => u.contentType)).toContain("image/jpeg");
  });

  it("a failed extract is failed with nothing saved, and still no throw", async () => {
    const { adapters } = fakeAdapters({ failAt: "extract" });
    const result = await reconstruct(job, { root: ROOT }, adapters);
    expect(result.finish).toEqual({ attempt: 2, outcome: "failed", reason: "reconstruction_failed", artifacts: [] });
    expect(result.stagesDone).toEqual([]);
  });

  it("logs stage names and counts, never a frame's path or the stderr dump", async () => {
    const { adapters, logs } = fakeAdapters({ failAt: "compress" });
    await reconstruct(job, { root: ROOT }, adapters);
    expect(logs.some((l) => l.includes("compress failed"))).toBe(true);
    for (const line of logs) {
      expect(line).not.toMatch(/processed\/images\//);
      expect(line).not.toMatch(/lots of stderr/);
    }
  });
});

describe("the two calls to Stead", () => {
  function fetchStub(responses: { status: number; body?: unknown }[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift() ?? { status: 500 };
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("claims with the bearer and treats 204 as an empty queue", async () => {
    const { impl, calls } = fetchStub([{ status: 204 }, { status: 200, body: { job } }]);
    const api = workerApi("https://stead.example/", "s3cret", impl);
    expect(await api.claim("w1")).toBeNull();
    expect(await api.claim("w1")).toEqual(job);
    expect(calls[0]?.url).toBe("https://stead.example/api/scan-worker/jobs/claim");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ workerId: "w1" });
  });

  it("finishes against the scan's own path and surfaces a refusal", async () => {
    const { impl, calls } = fetchStub([{ status: 200, body: { state: "needs_mask", notified: true } }, { status: 409, body: { error: "stale" } }]);
    const api = workerApi("https://stead.example", "s3cret", impl);
    const body = { attempt: 2, outcome: "needs_mask" as const, artifacts: [] };
    expect(await api.finish(SCAN, body)).toEqual({ state: "needs_mask", notified: true });
    expect(calls[0]?.url).toBe(`https://stead.example/api/scan-worker/jobs/${SCAN}/finish`);
    await expect(api.finish(SCAN, body)).rejects.toThrow(/409/);
  });
});
