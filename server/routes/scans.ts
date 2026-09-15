/**
 * Honesty scan routes (HM-01): the hub, starting a walk, recording its
 * location record, and discarding an unfinished one. All owner-only.
 *
 * The verdict is computed here, on the server, from the raw samples the phone
 * sends — never taken from the client — and stored through a SECURITY DEFINER
 * function. The response is the hub DTO, so the browser only ever displays
 * what the server decided. Video does not pass through here at all; the
 * recording stays on the phone until HM-02's presigned upload.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { judgeWalk } from "../lib/geofence";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  discardScan,
  getHostScan,
  getScanForJudging,
  recordScanLocation,
  startListingScan,
} from "../queries/scans";
import { HM, HONESTY_POLICY_VERSION } from "../../src/lib/honesty";

export const scanRoutes = new Hono<AppEnv>();

const NOT_YOURS = "No listing of yours here";

const startSchema = z.object({
  policyVersion: z.string().trim().min(1).max(40),
  // The sheet's checkbox, as a fact the server insists on rather than trusts.
  acknowledged: z.literal(true),
});

const sampleSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().int().min(0).max(100_000),
  phase: z.enum(["outdoor_start", "indoor", "outdoor_end"]),
});

// A 20-minute walk at one reading a second is ~1,200 samples; the cap is a
// body-size guard, not a product limit.
const locationSchema = z.object({
  samples: z.array(sampleSchema).max(20_000),
});

async function parse<T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Those details are not valid",
    });
  }
  return parsed.data as z.infer<T>;
}

scanRoutes.get("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, c.req.param("id"), HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  return c.json(hub);
});

scanRoutes.post("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const input = await parse(c, startSchema);

  // An acknowledgment of an older policy is not an acknowledgment of this one.
  if (input.policyVersion !== HONESTY_POLICY_VERSION) {
    throw new HTTPException(409, { message: HM["hm.sheet.policyChanged"] });
  }

  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  if (!hub.listing.hasPin) throw new HTTPException(409, { message: HM["hm.pin.required"] });

  const scanId = await tenantQuery(c, (tx) => startListingScan(tx, listingId, input.policyVersion));
  if (!scanId) throw new HTTPException(404, { message: NOT_YOURS });

  const after = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  const scan = after?.scan?.id === scanId ? after.scan : null;
  if (!scan) throw new HTTPException(500, { message: "The walk could not be started" });

  return c.json({ scanId, policyVersion: scan.policyVersion, thresholds: scan.thresholds }, 201);
});

scanRoutes.post("/:id/scan/:scanId/location", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const { samples } = await parse(c, locationSchema);

  const outcome = await tenantQuery(c, async (tx) => {
    const scan = await getScanForJudging(tx, host.id, listingId, scanId);
    if (!scan) return "missing" as const;
    if (scan.state !== "capturing" || scan.geofence !== "pending") return "closed" as const;
    const verdict = judgeWalk(scan.pin, samples, scan.thresholds);
    const stored = await recordScanLocation(tx, scanId, samples, verdict);
    return stored ? ("recorded" as const) : ("closed" as const);
  });

  if (outcome === "missing") throw new HTTPException(404, { message: NOT_YOURS });
  if (outcome === "closed") throw new HTTPException(409, { message: HM["hm.capture.notCurrent"] });

  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  return c.json(hub);
});

scanRoutes.delete("/:id/scan/:scanId", async (c) => {
  sessionUser(c);
  const ok = await tenantQuery(c, (tx) =>
    discardScan(tx, c.req.param("id"), c.req.param("scanId")),
  );
  // Either not theirs, or already judged and so not theirs to throw away.
  if (!ok) throw new HTTPException(404, { message: "No walk of yours to delete here" });
  return c.json({ ok: true });
});
