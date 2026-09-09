/**
 * file-claim / respond-claim / resolve-claim, plus evidence uploads.
 *
 * Money and state move only through the SECURITY DEFINER functions. Stripe
 * charges happen outside the transaction: the card-on-file lives on the host's
 * connected account, and a transaction must never span an outbound HTTP call.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { RATE_LIMITS, rateLimit } from "../lib/rateLimit";
import {
  claimFiledEmail,
  claimAcceptedEmail,
  claimDisputedEmail,
  claimResolvedEmail,
  sendEmail,
} from "../lib/email";
import { pgMessage } from "../lib/pgError";
import {
  chargeClaimOnHostAccount,
  HostConnectError,
  stripeConfigured,
} from "../lib/stripe";
import {
  claimEvidenceKey,
  presignImageUpload,
  publicUrlForKey,
  StorageError,
  storageConfigured,
} from "../lib/storage";
import {
  attachClaimEvidence,
  fileClaim,
  getClaimChargeContext,
  getClaimForViewer,
  getClaimNotice,
  listClaimsForViewer,
  resolveClaim,
  respondClaim,
  type ClaimOutcome,
} from "../queries/claims";

export const claimsRoutes = new Hono<AppEnv>();

const fileSchema = z.object({
  bookingId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  description: z.string().trim().min(1).max(4000),
});

const respondSchema = z.object({
  accept: z.boolean(),
});

const resolveSchema = z.object({
  outcome: z.enum(["host", "guest", "split"]),
  amountCents: z.number().int().min(0).optional(),
  note: z.string().trim().max(4000).optional(),
});

const photoUploadSchema = z.object({
  contentType: z.string().min(1).max(100),
});

const attachEvidenceSchema = z.object({
  key: z.string().min(1).max(500),
  note: z.string().trim().max(400).optional(),
});

async function parse<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T) {
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

function raiseFromPg(err: unknown, fallback: string): never {
  const message = pgMessage(err);
  if (
    /claim amount must be between/i.test(message) ||
    /claim description is required/i.test(message) ||
    /split amount must be between/i.test(message) ||
    /unknown resolution/i.test(message)
  ) {
    throw new HTTPException(400, { message: message.split(" | ")[0] ?? fallback });
  }
  throw err;
}

async function chargeIfNeeded(
  amountCents: number,
  ctx: {
    claimId: string;
    bookingId: string;
    setupIntentId: string | null;
    hostConnectAccountId: string | null;
  },
  kind: "accept" | "resolve",
): Promise<string | null> {
  if (amountCents < 1) return null;
  if (!stripeConfigured()) return null;
  if (!ctx.setupIntentId || ctx.setupIntentId.startsWith("seti_mock_")) return null;
  try {
    return await chargeClaimOnHostAccount({
      claimId: ctx.claimId,
      bookingId: ctx.bookingId,
      amountCents,
      setupIntentId: ctx.setupIntentId,
      hostAccountId: ctx.hostConnectAccountId ?? "",
      kind,
    });
  } catch (err) {
    if (err instanceof HostConnectError) {
      throw new HTTPException(409, { message: err.message });
    }
    throw err;
  }
}

claimsRoutes.get("/", async (c) => {
  const viewer = sessionUser(c);
  return c.json(await tenantQuery(c, (tx) => listClaimsForViewer(tx, viewer.id)));
});

claimsRoutes.post("/", rateLimit(RATE_LIMITS.claims), async (c) => {
  const host = sessionUser(c);
  const input = await parse(c, fileSchema);

  let claimId: string | null;
  try {
    claimId = await tenantQuery(c, (tx) =>
      fileClaim(tx, input.bookingId, input.amountCents, input.description),
    );
  } catch (err) {
    raiseFromPg(err, "Could not file that claim");
  }

  if (!claimId) {
    throw new HTTPException(409, {
      message: "This stay is not in an open claim window, or a claim is already on file.",
    });
  }

  const notice = await tenantQuery(c, (tx) => getClaimNotice(tx, claimId));
  if (notice) {
    await sendEmail({
      to: notice.guestEmail,
      ...claimFiledEmail({
        listingTitle: notice.listingTitle,
        amountCents: notice.amountCents,
      }),
    });
  }

  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, claimId, host.id));
  return c.json(claim, 201);
});

claimsRoutes.get("/:id", async (c) => {
  const viewer = sessionUser(c);
  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, c.req.param("id"), viewer.id));
  if (!claim) throw new HTTPException(404, { message: "No claim here" });
  return c.json(claim);
});

claimsRoutes.post("/:id/respond", rateLimit(RATE_LIMITS.claims), async (c) => {
  const guest = sessionUser(c);
  const claimId = c.req.param("id");
  const { accept } = await parse(c, respondSchema);

  const ctx = await tenantQuery(c, (tx) => getClaimChargeContext(tx, claimId));
  if (!ctx || ctx.guestId !== guest.id) {
    throw new HTTPException(404, { message: "No claim here" });
  }
  if (ctx.state !== "open") {
    throw new HTTPException(409, { message: "This claim has already been answered" });
  }

  const chargeId = accept ? await chargeIfNeeded(ctx.amountCents, ctx, "accept") : null;

  let ok: boolean;
  try {
    ok = await tenantQuery(c, (tx) => respondClaim(tx, claimId, accept, chargeId));
  } catch (err) {
    raiseFromPg(err, "Could not record that response");
  }
  if (!ok) {
    throw new HTTPException(409, { message: "This claim has already been answered" });
  }

  const notice = await tenantQuery(c, (tx) => getClaimNotice(tx, claimId));
  if (notice) {
    await sendEmail({
      to: notice.hostEmail,
      ...(accept
        ? claimAcceptedEmail({ listingTitle: notice.listingTitle, amountCents: notice.amountCents })
        : claimDisputedEmail({ listingTitle: notice.listingTitle })),
    });
  }

  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, claimId, guest.id));
  return c.json(claim);
});

claimsRoutes.post("/:id/resolve", rateLimit(RATE_LIMITS.claims), async (c) => {
  const arbiter = sessionUser(c);
  const claimId = c.req.param("id");
  const input = await parse(c, resolveSchema);

  const ctx = await tenantQuery(c, (tx) => getClaimChargeContext(tx, claimId));
  if (!ctx) throw new HTTPException(404, { message: "No claim here" });
  if (ctx.state !== "guest_disputed" && ctx.state !== "arbitration") {
    throw new HTTPException(409, { message: "This claim is not waiting on an arbiter" });
  }

  const chargeAmount =
    input.outcome === "host" ? ctx.amountCents : input.outcome === "guest" ? 0 : (input.amountCents ?? 0);
  const chargeId = await chargeIfNeeded(chargeAmount, ctx, "resolve");

  let ok: boolean;
  try {
    ok = await tenantQuery(c, (tx) =>
      resolveClaim(
        tx,
        claimId,
        input.outcome as ClaimOutcome,
        input.amountCents ?? null,
        input.note ?? null,
        chargeId,
      ),
    );
  } catch (err) {
    raiseFromPg(err, "Could not resolve that claim");
  }
  if (!ok) {
    throw new HTTPException(403, { message: "Only an arbiter can resolve a disputed claim" });
  }

  const notice = await tenantQuery(c, (tx) => getClaimNotice(tx, claimId));
  if (notice) {
    const mail = claimResolvedEmail({
      listingTitle: notice.listingTitle,
      resolutionAmountCents: notice.resolutionAmountCents ?? 0,
      outcome: input.outcome,
    });
    await sendEmail({ to: notice.guestEmail, ...mail });
    await sendEmail({ to: notice.hostEmail, ...mail });
  }

  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, claimId, arbiter.id));
  return c.json(claim);
});

claimsRoutes.post("/:id/evidence-upload", async (c) => {
  const viewer = sessionUser(c);
  const claimId = c.req.param("id");
  const { contentType } = await parse(c, photoUploadSchema);

  if (!storageConfigured()) {
    throw new HTTPException(503, { message: "Evidence uploads are not configured here" });
  }
  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, claimId, viewer.id));
  if (!claim) throw new HTTPException(404, { message: "No claim here" });
  if (!claim.canFileEvidence) {
    throw new HTTPException(409, { message: "Evidence can only be added while the claim is open" });
  }

  try {
    return c.json(await presignImageUpload(claimEvidenceKey(claimId, contentType), contentType));
  } catch (err) {
    if (err instanceof StorageError) throw new HTTPException(400, { message: err.message });
    throw err;
  }
});

claimsRoutes.post("/:id/evidence", async (c) => {
  const viewer = sessionUser(c);
  const claimId = c.req.param("id");
  const { key, note } = await parse(c, attachEvidenceSchema);

  if (!key.startsWith(`claims/${claimId}/`)) {
    throw new HTTPException(400, { message: "That upload does not belong to this claim" });
  }

  let evidenceId: string | null;
  try {
    evidenceId = await tenantQuery(c, (tx) =>
      attachClaimEvidence(tx, claimId, viewer.id, publicUrlForKey(key), note ?? null),
    );
  } catch {
    throw new HTTPException(409, { message: "Evidence can only be added while the claim is open" });
  }
  if (!evidenceId) {
    throw new HTTPException(404, { message: "No claim here" });
  }

  const claim = await tenantQuery(c, (tx) => getClaimForViewer(tx, claimId, viewer.id));
  return c.json(claim, 201);
});
