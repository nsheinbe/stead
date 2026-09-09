/**
 * Messaging. Thread key is (listing_id, guest_id). Guests may write before a
 * booking exists. RLS is the two participants; mark-read is a definer
 * function because clients cannot write read_at.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingPhotos, listings, messages, profiles } from "../db/schema";
import type { MessageItem, MessageThread, MessageThreadDetail } from "../../src/lib/types";

export class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageError";
  }
}

export async function unreadCountFor(tx: Tx, memberId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.recipientId, memberId), sql`${messages.readAt} IS NULL`));
  return Number(rows[0]?.n ?? 0);
}

export async function listThreadsFor(tx: Tx, memberId: string): Promise<MessageThread[]> {
  const rows = (await tx.execute(sql`
    WITH threads AS (
      SELECT m.listing_id,
             CASE WHEN m.sender_id = l.host_id THEN m.recipient_id ELSE m.sender_id END AS guest_id,
             (array_agg(m.body ORDER BY m.created_at DESC))[1] AS last_body,
             max(m.created_at) AS last_at,
             count(*) FILTER (WHERE m.recipient_id = ${memberId}::uuid AND m.read_at IS NULL)::int AS unread
        FROM public.messages m
        JOIN public.listings l ON l.id = m.listing_id
       WHERE m.sender_id = ${memberId}::uuid OR m.recipient_id = ${memberId}::uuid
       GROUP BY 1, 2
    )
    SELECT t.listing_id,
           t.guest_id,
           l.title AS listing_title,
           (
             SELECT p.storage_path
               FROM public.listing_photos p
              WHERE p.listing_id = t.listing_id
              ORDER BY p.sort_order
              LIMIT 1
           ) AS listing_photo,
           CASE
             WHEN l.host_id = ${memberId}::uuid THEN COALESCE(NULLIF(gp.display_name, ''), 'Guest')
             ELSE COALESCE(NULLIF(hp.display_name, ''), 'Host')
           END AS counterpart_name,
           t.last_body,
           t.last_at,
           t.unread
      FROM threads t
      JOIN public.listings l ON l.id = t.listing_id
      JOIN public.profiles gp ON gp.id = t.guest_id
      JOIN public.profiles hp ON hp.id = l.host_id
     ORDER BY t.last_at DESC
  `)) as unknown as {
    listing_id: string;
    guest_id: string;
    listing_title: string;
    listing_photo: string | null;
    counterpart_name: string;
    last_body: string;
    last_at: Date | string;
    unread: number;
  }[];

  return rows.map((row) => ({
    listingId: row.listing_id,
    guestId: row.guest_id,
    listingTitle: row.listing_title,
    listingPhoto: row.listing_photo,
    counterpartName: row.counterpart_name,
    lastBody: row.last_body,
    lastAt: new Date(row.last_at).toISOString(),
    unreadCount: Number(row.unread),
  }));
}

export async function getThread(
  tx: Tx,
  listingId: string,
  guestId: string,
  viewerId: string,
): Promise<MessageThreadDetail | null> {
  const listing = await tx.query.listings.findFirst({
    where: eq(listings.id, listingId),
    columns: { id: true, hostId: true, title: true },
    with: {
      host: { columns: { id: true, displayName: true } },
      photos: { orderBy: asc(listingPhotos.sortOrder), limit: 1 },
    },
  });
  if (!listing) return null;
  if (viewerId !== listing.hostId && viewerId !== guestId) return null;

  const guest = await tx.query.profiles.findFirst({
    where: eq(profiles.id, guestId),
    columns: { id: true, displayName: true },
  });
  if (!guest) return null;

  const rows = await tx.query.messages.findMany({
    where: and(
      eq(messages.listingId, listingId),
      or(eq(messages.senderId, guestId), eq(messages.recipientId, guestId)),
    ),
    orderBy: asc(messages.createdAt),
  });

  const viewerIsHost = viewerId === listing.hostId;
  return {
    listingId,
    guestId,
    listingTitle: listing.title,
    listingPhoto: listing.photos[0]?.storagePath ?? null,
    counterpartName: viewerIsHost
      ? guest.displayName || "Guest"
      : listing.host?.displayName || "Host",
    viewerIsHost,
    messages: rows.map((m) => ({
      id: m.id,
      listingId: m.listingId,
      bookingId: m.bookingId,
      senderId: m.senderId,
      recipientId: m.recipientId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt?.toISOString() ?? null,
      mine: m.senderId === viewerId,
    })),
  };
}

export type SendMessageInput = {
  listingId: string;
  body: string;
  guestId?: string;
  bookingId?: string;
};

export type SentMessage = MessageItem & {
  recipientEmail: string;
  recipientName: string;
  senderName: string;
  listingTitle: string;
};

export async function sendMessage(
  tx: Tx,
  senderId: string,
  input: SendMessageInput,
): Promise<SentMessage> {
  const body = input.body.trim();
  if (body.length < 1 || body.length > 4000) {
    throw new MessageError("Write between 1 and 4,000 characters");
  }

  const listing = await tx.query.listings.findFirst({
    where: eq(listings.id, input.listingId),
    columns: { id: true, hostId: true, title: true },
    with: { host: { columns: { displayName: true } } },
  });
  if (!listing) throw new MessageError("Listing not found");

  const isHost = senderId === listing.hostId;
  const guestId = isHost ? input.guestId : senderId;
  if (!guestId) throw new MessageError("guestId is required when the host writes first");
  if (guestId === listing.hostId) throw new MessageError("Hosts message guests, not themselves");

  const recipientId = isHost ? guestId : listing.hostId;

  let bookingId = input.bookingId ?? null;
  if (!bookingId) {
    const booked = (await tx.execute(sql`
      SELECT id
        FROM public.bookings
       WHERE listing_id = ${listing.id}::uuid
         AND guest_id = ${guestId}::uuid
         AND status IN ('pending_payment', 'confirmed', 'checked_in', 'completed')
       ORDER BY created_at DESC
       LIMIT 1
    `)) as unknown as { id: string }[];
    bookingId = booked[0]?.id ?? null;
  }

  const [created] = await tx
    .insert(messages)
    .values({
      listingId: listing.id,
      bookingId,
      senderId,
      recipientId,
      body,
    })
    .returning();
  if (!created) throw new MessageError("Could not send that message");

  const notify = (await tx.execute(sql`
    SELECT email, recipient_name, sender_name, listing_title
      FROM app.recipient_for_sent_message(${created.id}::uuid)
  `)) as unknown as {
    email: string;
    recipient_name: string;
    sender_name: string;
    listing_title: string;
  }[];
  const to = notify[0];
  if (!to) throw new MessageError("Recipient not found");

  return {
    id: created.id,
    listingId: created.listingId,
    bookingId: created.bookingId,
    senderId: created.senderId,
    recipientId: created.recipientId,
    body: created.body,
    createdAt: created.createdAt.toISOString(),
    readAt: created.readAt?.toISOString() ?? null,
    mine: true,
    recipientEmail: to.email,
    recipientName: to.recipient_name,
    senderName: to.sender_name,
    listingTitle: to.listing_title,
  };
}

export async function markThreadRead(tx: Tx, listingId: string, guestId: string): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT app.mark_thread_read(${listingId}::uuid, ${guestId}::uuid) AS n`,
  )) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}
