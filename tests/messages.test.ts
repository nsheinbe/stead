/**
 * Slice 6 — send-message, unread, mark-read. RLS probes live in rls.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  getThread,
  listThreadsFor,
  markThreadRead,
  sendMessage,
  unreadCountFor,
} from "../server/queries/messages";
import {
  asMember,
  asOwner,
  closeTestDb,
  id,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("send-message", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("notifies, counts unread, and clears the badge when the host reads", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Nora", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Sam");
    await insertListing({ id: listingId, hostId, title: "Lemon House" });

    const sent = await asMember(guestId, (tx) =>
      sendMessage(tx, guestId, { listingId, body: "Is August still free?" }),
    );
    expect(sent.recipientEmail).toContain("@stead.example");
    expect(sent.listingTitle).toBe("Lemon House");

    expect(await asMember(hostId, (tx) => unreadCountFor(tx, hostId))).toBe(1);
    expect(await asMember(guestId, (tx) => unreadCountFor(tx, guestId))).toBe(0);

    const inbox = await asMember(hostId, (tx) => listThreadsFor(tx, hostId));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.unreadCount).toBe(1);
    expect(inbox[0]?.guestId).toBe(guestId);

    await asMember(hostId, (tx) => markThreadRead(tx, listingId, guestId));
    expect(await asMember(hostId, (tx) => unreadCountFor(tx, hostId))).toBe(0);

    const thread = await asMember(hostId, (tx) => getThread(tx, listingId, guestId, hostId));
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.counterpartName).toBe("Sam");

    await asMember(hostId, (tx) =>
      sendMessage(tx, hostId, { listingId, guestId, body: "Yes — the courtyard is open." }),
    );
    expect(await asMember(guestId, (tx) => unreadCountFor(tx, guestId))).toBe(1);

    const rate = await asOwner(async (db) => {
      const rows = (await db.execute(sql`
        SELECT response_rate FROM public.trust_stats WHERE profile_id = ${hostId}::uuid
      `)) as unknown as { response_rate: string | number | null }[];
      return rows[0]?.response_rate == null ? null : Number(rows[0].response_rate);
    });
    expect(rate).toBe(1);
  });
});
