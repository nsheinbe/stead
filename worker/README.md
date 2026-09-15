# Stead reconstruction worker (HM-03)

Turns a host's walk into a 3D walkthrough: the video the phone recorded
becomes camera poses and a Gaussian splat, which the host then checks and
masks before it can be verified. This package is the worker's loop; the
pipeline it runs is in [`src/pipeline.ts`](src/pipeline.ts).

It is deliberately dumb about Stead. It knows two URLs and a secret.

## What it never does

- **No generative step.** Stitch, stabilize, compress, crop. Nothing that
  invents a room, fills a wall, or "cleans up" a frame. The plan is checked
  before it runs (`planIsClean`) and a test asserts the stage list.
- **No closed reconstruction API.** No Luma or similar. Nothing leaves the
  machine except the finished artifacts going to Stead's own bucket.
- **No database credential.** DECISIONS D03: the worker calls
  `/api/scan-worker/*` with `SCAN_WORKER_SECRET`, and those routes run as
  `app_user` through the `SECURITY DEFINER` job functions. Three roles stay
  three roles.
- **No footage in the logs.** It logs scan ids, stage names and exit codes.
  Never the notes, never the location record, never a path into the frames.
- **Nothing outlives the job on disk.** The temp directory is removed when
  the job finishes, however it finishes.

## How it runs

```
claim  →  POST /api/scan-worker/jobs/claim          uploaded → reconstructing (attempt + 1)
run    →  extract · stills · train · export · compress
finish →  POST /api/scan-worker/jobs/:scanId/finish reconstructing → needs_mask | failed
```

A finish that names a stale attempt is a `409` and writes nothing: a worker
that lost its claim to the stale-release cron cannot overwrite a newer run.
A claim older than `scan_claim_stale_hours` (app_config, default 6) is
returned to the queue by `/api/cron/release-stale-scan-jobs`, or marked
`failed` once `scan_max_attempts` (default 3) is spent.

A reconstruction that fails is an honest `failed` with the stills already
uploaded, so the host can see what the worker saw, plus **Try processing
again** (the same footage; capped) and **Walk again**.

### Stages

| Stage | Tool | Output |
| --- | --- | --- |
| extract | `ns-process-data video` (ffmpeg + COLMAP) | `processed/images/`, `processed/transforms.json` |
| stills | the pipeline itself | up to 8 real frames, evenly spaced, uploaded first |
| train | `ns-train splatfacto` (Nerfstudio + gsplat) | a training config |
| export | `ns-export gaussian-splat` | `splat.ply` |
| compress | `splat-transform` (PlayCanvas) | `splat.compressed.ply` |

Outputs land under the job's `outputPrefix`
(`listings/<listingId>/scans/<scanId>/`) with deterministic names, so a
retry overwrites rather than accumulates. The server refuses any key
outside that prefix.

### Environment

| Variable | Purpose |
| --- | --- |
| `STEAD_API_URL` | the deployment, e.g. `https://openstead.app` |
| `SCAN_WORKER_SECRET` | the bearer the API expects; same value as the app's |
| `SCAN_WORKER_ID` | a name for this worker in `listing_scans.worker_id` (default `worker-<pid>`) |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | the same bucket the app presigns into |
| `SCAN_WORKER_ONCE=1` | process at most one job, then exit (CI, cron-driven hosts) |
| `SCAN_WORKER_POLL_SECONDS` | wait when the queue is empty (default 60) |
| `SCAN_TOOL_NS_PROCESS_DATA`, `SCAN_TOOL_NS_TRAIN`, `SCAN_TOOL_NS_EXPORT`, `SCAN_TOOL_SPLAT_TRANSFORM` | override a tool's path |
| `SCAN_TRAIN_ITERATIONS` | splatfacto iterations (default 15000) |

The worker holds bucket credentials because it reads the walk and writes
the outputs. It holds nothing that reaches Postgres.

### Running it

```bash
# From the repo root, with the tools above on PATH:
STEAD_API_URL=http://localhost:5173 SCAN_WORKER_SECRET=… S3_BUCKET=… npm run worker:scan
```

A GPU is not required by this package, but `ns-train splatfacto` is slow
without one. Where the worker runs — a Linux box, a container, a Visual
Rails job later — is unspecified on purpose (BUILD-PLAN §5); nothing here
picks a vendor.

## Licenses

See [`LICENSES.md`](LICENSES.md). Pins and the license text at the pinned
revisions are recorded when the image is built (HM-09's runbook); this
package records the license class of each tool and refuses the hard-avoid
list by name.
