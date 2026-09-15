# Third-party tools the reconstruction worker calls

The worker shells out to these; none is vendored into this repository.
Licenses below are the projects' stated licenses as of this file's date
(2026-09-15). **Re-read each LICENSE at the revision you pin** — the pins
and the verified text belong in HM-09's runbook, next to the container
image that installs them. This file is the class of license, not legal
advice (BUILD-PLAN §5).

| Tool | Used for | Stated license | Home |
| --- | --- | --- | --- |
| COLMAP | camera poses (called through `ns-process-data`) | BSD-3-Clause | https://github.com/colmap/colmap |
| Nerfstudio (`ns-process-data`, `ns-train splatfacto`, `ns-export`) | frame extraction, training, export | Apache-2.0 | https://github.com/nerfstudio-project/nerfstudio |
| gsplat | the splatting backend splatfacto trains with | Apache-2.0 | https://github.com/nerfstudio-project/gsplat |
| PlayCanvas `splat-transform` (the SuperSplat CLI) | compress / crop only | MIT | https://github.com/playcanvas/splat-transform |
| ffmpeg | frame extraction (called through `ns-process-data`) | LGPL-2.1+ / GPL-2.0+ depending on build flags | https://ffmpeg.org |

## Not used, by policy

| Item | Why |
| --- | --- |
| INRIA 3D Gaussian Splatting reference implementation | non-commercial license |
| DUSt3R / MASt3R | non-commercial license |
| Luma or any closed reconstruction API | closed model, no self-host path, beautify risk |
| OpenMVS as the hosted service's core | AGPL |
| Mapillary as the sole outdoor layer | one commercial vendor; not this worker's concern |
| Any generative completion step | honesty policy (`docs/honesty-media/POLICY.md`) |

`worker/src/pipeline.ts` refuses to run a plan naming any of the first
four, and `tests/worker-pipeline.test.ts` asserts the stage list.

Copyright 2026 Stead contributors.
