/**
 * HM-03 — the reconstruction pipeline, as a plan and a runner.
 *
 * Everything that touches the world is injected (`Adapters`): downloading
 * and uploading objects, running a command, listing a directory. That keeps
 * the pipeline itself pure enough to test without COLMAP on the machine, and
 * it makes the stage list a fact the tests can assert on: there is no
 * generative stage, no closed reconstruction API, and no tool from the
 * hard-avoid list (docs/honesty-media/BUILD-PLAN.md §5).
 *
 * Stages, in order:
 *
 *   extract   ns-process-data video  → images/ + transforms.json (ffmpeg + COLMAP)
 *   stills    pick up to 8 real frames, evenly spaced, and upload them first —
 *             so a failure later still leaves the host something honest to see
 *   train     ns-train splatfacto    → a config the export step loads
 *   export    ns-export gaussian-splat → splat.ply
 *   compress  splat-transform        → splat.compressed.ply (PlayCanvas, crop / compress only)
 *
 * Every output key sits under the job's `outputPrefix`; the server's
 * app.finish_scan_job refuses anything else.
 */
import type { ScanJob, ScanJobArtifact, ScanJobFinish, ScanWorkerArtifactKind } from "../../src/lib/types";

export type StageName = "extract" | "stills" | "train" | "export" | "compress";

export const STAGE_NAMES: readonly StageName[] = ["extract", "stills", "train", "export", "compress"];

/** Tools the pipeline calls. Overridable by env so a container can pin its own paths. */
export type ToolConfig = {
  nsProcessData: string;
  nsTrain: string;
  nsExport: string;
  splatTransform: string;
  /** Frames per second to sample from the walk. */
  extractFps: number;
  /** Training iterations for splatfacto. */
  trainIterations: number;
};

export const DEFAULT_TOOLS: ToolConfig = {
  nsProcessData: "ns-process-data",
  nsTrain: "ns-train",
  nsExport: "ns-export",
  splatTransform: "splat-transform",
  extractFps: 2,
  trainIterations: 15_000,
};

/** Names of things this worker must never call. The test asserts the plan is clean. */
export const BANNED_TOOL_PATTERNS: readonly RegExp[] = [
  /luma/i,
  /dust3r/i,
  /mast3r/i,
  /openmvs/i,
  /gaussian[-_]splatting/i, // the INRIA reference implementation (non-commercial)
  /mapillary/i,
  /inpaint/i,
  /generat/i,
  /diffusion/i,
  /beautif/i,
  /enhance/i,
];

export type Command = { stage: StageName; command: string; args: string[]; cwd?: string };

export type Adapters = {
  /** Fetch one object from the bucket to a local path. */
  download(key: string, toPath: string): Promise<void>;
  /** Put one local file into the bucket. */
  upload(fromPath: string, key: string, contentType: string): Promise<{ sizeBytes: number }>;
  /** Run a command to completion; rejects on a non-zero exit. */
  run(command: Command): Promise<void>;
  /** File names (not paths) directly inside a directory, sorted. */
  listFiles(dir: string): Promise<string[]>;
  /** Size of a local file in bytes. */
  fileSize(path: string): Promise<number>;
  /** Read a small text file. */
  readText(path: string): Promise<string>;
  /** Write a small text file. */
  writeText(path: string, text: string): Promise<void>;
  /** One line of log. Never the contents of an object, never a host's notes. */
  log(line: string): void;
};

export type Workdir = { root: string };

export const MAX_STILLS = 8;

/** Where each output lands, under the job's prefix. Deterministic, so a retry overwrites. */
export function outputKeys(job: ScanJob) {
  const p = job.outputPrefix;
  return {
    frames: `${p}frames.json`,
    cameras: `${p}cameras.json`,
    splat: `${p}splat.ply`,
    splatCompressed: `${p}splat.compressed.ply`,
    still: (index: number) => `${p}stills/${String(index).padStart(2, "0")}.jpg`,
  };
}

/** Which of the extracted frames become stills: at most MAX_STILLS, evenly spaced. */
export function pickStills(frameNames: readonly string[], max = MAX_STILLS): string[] {
  const frames = frameNames.filter((name) => /\.(jpe?g|png)$/i.test(name));
  if (frames.length <= max) return [...frames];
  const out: string[] = [];
  for (let i = 0; i < max; i += 1) {
    const index = Math.floor((i * (frames.length - 1)) / (max - 1));
    const name = frames[index];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

export function extensionFor(contentType: string): string {
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return "mp4";
}

/** The commands the runner will issue, in order, before anything runs. */
export function planCommands(job: ScanJob, dir: Workdir, tools: ToolConfig = DEFAULT_TOOLS): Command[] {
  const video = `${dir.root}/video.${extensionFor(job.inputs.videoContentType)}`;
  const processed = `${dir.root}/processed`;
  const trained = `${dir.root}/trained`;
  const exported = `${dir.root}/exported`;
  return [
    {
      stage: "extract",
      command: tools.nsProcessData,
      args: ["video", "--data", video, "--output-dir", processed, "--num-frames-target", String(job.thresholds.accuracyMaxM > 0 ? 300 : 300)],
    },
    {
      stage: "train",
      command: tools.nsTrain,
      args: [
        "splatfacto",
        "--data",
        processed,
        "--output-dir",
        trained,
        "--experiment-name",
        "walk",
        "--timestamp",
        "run",
        "--max-num-iterations",
        String(tools.trainIterations),
        "--viewer.quit-on-train-completion",
        "True",
      ],
    },
    {
      stage: "export",
      command: tools.nsExport,
      args: [
        "gaussian-splat",
        "--load-config",
        `${trained}/walk/splatfacto/run/config.yml`,
        "--output-dir",
        exported,
      ],
    },
    {
      stage: "compress",
      command: tools.splatTransform,
      args: [`${exported}/splat.ply`, `${exported}/splat.compressed.ply`],
    },
  ];
}

export function planIsClean(commands: readonly Command[]): { ok: true } | { ok: false; offending: string } {
  for (const c of commands) {
    for (const text of [c.command, ...c.args]) {
      for (const re of BANNED_TOOL_PATTERNS) {
        if (re.test(text)) return { ok: false, offending: text };
      }
    }
  }
  return { ok: true };
}

export type RunResult = { finish: ScanJobFinish; stagesDone: StageName[] };

/**
 * Run the job. Never throws for a reconstruction failure: that is a
 * `failed` outcome with the stills already uploaded. Throws only when the
 * plan itself is unsafe, which is a programming error, not a bad walk.
 */
export async function reconstruct(
  job: ScanJob,
  dir: Workdir,
  adapters: Adapters,
  tools: ToolConfig = DEFAULT_TOOLS,
): Promise<RunResult> {
  const commands = planCommands(job, dir, tools);
  const clean = planIsClean(commands);
  if (!clean.ok) throw new Error(`refusing to run a plan that names ${clean.offending}`);

  const keys = outputKeys(job);
  const artifacts: ScanJobArtifact[] = [];
  const stagesDone: StageName[] = [];
  const record = (kind: ScanWorkerArtifactKind, objectKey: string, contentType: string, sizeBytes: number) =>
    artifacts.push({ kind, objectKey, contentType, sizeBytes });
  const byStage = (stage: StageName) => {
    const found = commands.find((c) => c.stage === stage);
    if (!found) throw new Error(`no ${stage} command planned`);
    return found;
  };
  const fail = (): RunResult => ({
    finish: { attempt: job.attempt, outcome: "failed", reason: "reconstruction_failed", artifacts },
    stagesDone,
  });

  const video = `${dir.root}/video.${extensionFor(job.inputs.videoContentType)}`;
  const processed = `${dir.root}/processed`;
  const exported = `${dir.root}/exported`;

  adapters.log(`scan ${job.scanId} attempt ${job.attempt}: download`);
  await adapters.download(job.inputs.videoKey, video);
  // The location record and the notes are the host's; the pipeline never reads them.

  // extract -----------------------------------------------------------------
  try {
    adapters.log(`scan ${job.scanId}: extract`);
    await adapters.run(byStage("extract"));
    stagesDone.push("extract");
  } catch (err) {
    adapters.log(`scan ${job.scanId}: extract failed (${describe(err)})`);
    return fail();
  }

  // stills — before anything can fail again ----------------------------------
  try {
    const frames = await adapters.listFiles(`${processed}/images`);
    const chosen = pickStills(frames);
    for (const [index, name] of chosen.entries()) {
      const { sizeBytes } = await adapters.upload(`${processed}/images/${name}`, keys.still(index), "image/jpeg");
      record("stills", keys.still(index), "image/jpeg", sizeBytes);
    }
    await adapters.writeText(
      `${dir.root}/frames.json`,
      JSON.stringify({ count: frames.length, fps: tools.extractFps, stills: chosen.length }),
    );
    const frameManifest = await adapters.upload(`${dir.root}/frames.json`, keys.frames, "application/json");
    record("frames", keys.frames, "application/json", frameManifest.sizeBytes);
    stagesDone.push("stills");
    adapters.log(`scan ${job.scanId}: ${chosen.length} stills from ${frames.length} frames`);
  } catch (err) {
    adapters.log(`scan ${job.scanId}: stills failed (${describe(err)})`);
    return fail();
  }

  // cameras: COLMAP's poses as nerfstudio wrote them --------------------------
  try {
    const cameras = await adapters.upload(`${processed}/transforms.json`, keys.cameras, "application/json");
    record("cameras", keys.cameras, "application/json", cameras.sizeBytes);
  } catch (err) {
    adapters.log(`scan ${job.scanId}: no camera list (${describe(err)})`);
    return fail();
  }

  // train → export → compress ---------------------------------------------------
  for (const stage of ["train", "export", "compress"] as const) {
    try {
      adapters.log(`scan ${job.scanId}: ${stage}`);
      await adapters.run(byStage(stage));
      stagesDone.push(stage);
    } catch (err) {
      adapters.log(`scan ${job.scanId}: ${stage} failed (${describe(err)})`);
      return fail();
    }
  }

  try {
    const splat = await adapters.upload(`${exported}/splat.ply`, keys.splat, "application/octet-stream");
    record("splat", keys.splat, "application/octet-stream", splat.sizeBytes);
    const compressed = await adapters.upload(
      `${exported}/splat.compressed.ply`,
      keys.splatCompressed,
      "application/octet-stream",
    );
    record("splat_compressed", keys.splatCompressed, "application/octet-stream", compressed.sizeBytes);
  } catch (err) {
    adapters.log(`scan ${job.scanId}: upload failed (${describe(err)})`);
    return fail();
  }

  return { finish: { attempt: job.attempt, outcome: "needs_mask", artifacts }, stagesDone };
}

/** An error, without anything that could be a path into the home's footage. */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]?.slice(0, 200) ?? "unknown";
}
