/**
 * HM-03 — the reconstruction worker's two calls (DECISIONS D03).
 *
 * The worker is not a member and holds no database credential. It presents
 * `Authorization: Bearer $SCAN_WORKER_SECRET`, the same shape as the cron
 * endpoints, and these routes run as app_user with no app.user_id — so every
 * write goes through the SECURITY DEFINER job functions, which re-check the
 * row's state and the attempt number themselves.
 *
 *   POST /scan-worker/jobs/claim            uploaded → reconstructing, or 204
 *   POST /scan-worker/jobs/:scanId/finish   reconstructing → needs_mask / failed
 *
 * A finish with a stale attempt is a 409 and writes nothing: a worker that
 * lost its claim to the stale-release cron cannot overwrite a newer run.
 * Artifact keys outside the scan's prefix are a 400 from the function.
 */
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { MASK_COPY, SCAN_REASON_COPY } from "../../src/lib/honestyCopy";
import type { ScanJob, ScanWorkerArtifactKind } from "../../src/lib/types";
import {
  scanFailedEmail,
  scanReadyToCheckEmail,
  scanStatusUrl,
  scanVerifiedEmail,
  sendEmail,
} from "../lib/email";
import { tenantQuery, type AppEnv } from "../lib/http";
import { pgCode, pgMessage } from "../lib/pgError";
import { WORKER_ARTIFACT_KINDS } from "../lib/scanStorage";
import { claimNextScanJob, finishScanJob } from "../queries/scans";

export const scanWorkerRoutes = new Hono<AppEnv>();

function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertWorkerCaller(header: string | undefined): void {
  const secret = process.env.SCAN_WORKER_SECRET;
  if (!secret) {
    throw new HTTPException(500, { message: "SCAN_WORKER_SECRET is not set" });
  }
  if (!header || !secretsMatch(header, `Bearer ${secret}`)) {
    throw new HTTPException(401, { message: "Not a reconstruction worker" });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const claimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
});

const artifactSchema = z.object({
  kind: z.enum(WORKER_ARTIFACT_KINDS as [string, ...string[]]),
  objectKey: z.string().min(1).max(500),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().nonnegative(),
});

const finishSchema = z.discriminatedUnion("outcome", [
  z.object({
    attempt: z.number().int().positive(),
    outcome: z.literal("needs_mask"),
    artifacts: z.array(artifactSchema).max(200),
  }),
  // HM-04: only a crop job may finish verified, which the function re-checks.
  z.object({
    attempt: z.number().int().positive(),
    outcome: z.literal("verified"),
    artifacts: z.array(artifactSchema).max(200),
  }),
  z.object({
    attempt: z.number().int().positive(),
    outcome: z.literal("failed"),
    reason: z.literal("reconstruction_failed"),
    artifacts: z.array(artifactSchema).max(200),
  }),
]);

async function parse<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HTTPException(400, { message: `${where}${issue?.message ?? "Those details are not valid"}` });
  }
  return parsed.data as z.infer<T>;
}

scanWorkerRoutes.post("/jobs/claim", async (c) => {
  assertWorkerCaller(c.req.header("authorization"));
  const { workerId } = await parse(c, claimSchema);
  const job = await tenantQuery(c, (tx) => claimNextScanJob(tx, workerId));
  if (!job) return c.body(null, 204);
  const body: { job: ScanJob } = { job };
  return c.json(body);
});

scanWorkerRoutes.post("/jobs/:scanId/finish", async (c) => {
  assertWorkerCaller(c.req.header("authorization"));
  const scanId = c.req.param("scanId");
  if (!UUID.test(scanId)) throw new HTTPException(404, { message: "No such job" });
  const body = await parse(c, finishSchema);

  let finished;
  try {
    finished = await tenantQuery(c, (tx) =>
      finishScanJob(tx, {
        scanId,
        attempt: body.attempt,
        outcome: body.outcome,
        reason: body.outcome === "failed" ? body.reason : null,
        artifacts: body.artifacts.map((a) => ({
          kind: a.kind as ScanWorkerArtifactKind,
          objectKey: a.objectKey,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
        })),
      }),
    );
  } catch (err) {
    // RAISE EXCEPTION in the function: a key outside the prefix, a kind the
    // worker may not record, a needs_mask without its splat. The worker sent
    // something wrong; say what.
    if (pgCode(err) === "P0001") throw new HTTPException(400, { message: pgMessage(err) });
    throw err;
  }
  if (!finished) {
    throw new HTTPException(409, {
      message: "That job is no longer this worker's: the attempt is stale or the scan has moved on.",
    });
  }

  // After the transaction has committed, never inside it (CLAUDE.md).
  const statusUrl = scanStatusUrl(finished.listingId);
  const mail =
    body.outcome === "needs_mask"
      ? scanReadyToCheckEmail({ listingTitle: finished.listingTitle, statusUrl })
      : body.outcome === "verified"
        ? scanVerifiedEmail({
            listingTitle: finished.listingTitle,
            statusUrl,
            coverage: MASK_COPY.verifiedCoverageCropped,
          })
        : scanFailedEmail({
            listingTitle: finished.listingTitle,
            statusUrl,
            reason: SCAN_REASON_COPY.reconstruction_failed,
          });
  const notified = await sendEmail({ to: finished.hostEmail, ...mail });
  return c.json({ scanId, state: finished.state, notified });
});
