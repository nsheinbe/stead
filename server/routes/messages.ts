/**
 * send-message and the inbox. Threads are (listing_id, guest_id). Email notify
 * is after the insert commits — a bounced mail must not roll the message back.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { newMessageEmail, sendEmail } from "../lib/email";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  getThread,
  listThreadsFor,
  markThreadRead,
  MessageError,
  sendMessage,
  unreadCountFor,
} from "../queries/messages";

export const messagesRoutes = new Hono<AppEnv>();

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

const sendSchema = z.object({
  listingId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  guestId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
});

messagesRoutes.get("/", async (c) => {
  const me = sessionUser(c);
  return c.json(await tenantQuery(c, (tx) => listThreadsFor(tx, me.id)));
});

messagesRoutes.get("/unread", async (c) => {
  const me = sessionUser(c);
  const unread = await tenantQuery(c, (tx) => unreadCountFor(tx, me.id));
  return c.json({ unread });
});

messagesRoutes.get("/:listingId/:guestId", async (c) => {
  const me = sessionUser(c);
  const listingId = c.req.param("listingId");
  const guestId = c.req.param("guestId");
  const thread = await tenantQuery(c, (tx) => getThread(tx, listingId, guestId, me.id));
  if (!thread) throw new HTTPException(404, { message: "Thread not found" });
  return c.json(thread);
});

messagesRoutes.post("/:listingId/:guestId/read", async (c) => {
  const me = sessionUser(c);
  const listingId = c.req.param("listingId");
  const guestId = c.req.param("guestId");
  try {
    const marked = await tenantQuery(c, (tx) => markThreadRead(tx, listingId, guestId));
    return c.json({ ok: true, marked, reader: me.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not mark read";
    if (/not a participant|not signed in|listing not found/i.test(message)) {
      throw new HTTPException(403, { message: "Not a participant on this thread" });
    }
    throw err;
  }
});

messagesRoutes.post("/", async (c) => {
  const me = sessionUser(c);
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: "listingId and body are required" });
  }

  let sent;
  try {
    sent = await tenantQuery(c, (tx) => sendMessage(tx, me.id, parsed.data));
  } catch (err) {
    if (err instanceof MessageError) {
      throw new HTTPException(400, { message: err.message });
    }
    throw err;
  }

  const threadGuestId = parsed.data.guestId ?? sent.senderId;
  void sendEmail({
    to: sent.recipientEmail,
    ...newMessageEmail({
      senderName: sent.senderName,
      listingTitle: sent.listingTitle,
      preview: sent.body,
      threadUrl: `${appUrl()}/messages/${sent.listingId}/${threadGuestId}`,
    }),
  });

  return c.json({
    id: sent.id,
    listingId: sent.listingId,
    bookingId: sent.bookingId,
    senderId: sent.senderId,
    recipientId: sent.recipientId,
    body: sent.body,
    createdAt: sent.createdAt,
    readAt: sent.readAt,
    mine: true,
  });
});
