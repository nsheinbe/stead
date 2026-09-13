/**
 * Idempotent operator tool: pause the six Slice-1 demo listings by known id.
 *
 * Production Neon already paused these rows (host a0eebc99-… / nora@stead.example).
 * This does not create listings, does not re-activate them, and does not seed.
 *
 *   DATABASE_URL_OWNER=... npm run db:pause-seed-listings
 *
 * Equivalent SQL (owner, direct host):
 *
 *   UPDATE public.listings
 *      SET status = 'paused'
 *    WHERE host_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
 *      AND id IN (
 *        '11111111-1111-1111-1111-111111111111',
 *        '22222222-2222-2222-2222-222222222222',
 *        '33333333-3333-3333-3333-333333333333',
 *        '44444444-4444-4444-4444-444444444444',
 *        '55555555-5555-5555-5555-555555555555',
 *        '66666666-6666-6666-6666-666666666666'
 *      );
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../server/db/client";
import { HOST_ID, SEED_LISTING_IDS } from "./seed";

const seedIdList = sql.join(
  SEED_LISTING_IDS.map((id) => sql`${id}::uuid`),
  sql`, `,
);

export async function pauseSeedListings(db: Db): Promise<string[]> {
  const rows = (await db.execute<{ id: string }>(sql`
    UPDATE public.listings
       SET status = 'paused'
     WHERE host_id = ${HOST_ID}::uuid
       AND id IN (${seedIdList})
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      "DATABASE_URL_OWNER is required — the table owner on the direct (non-pooled) host. " +
        "Never commit it; export it in your shell.",
    );
    process.exit(1);
  }
  const paused = await pauseSeedListings(createDb(url));
  if (paused.length === 0) {
    console.log("No matching seed listings found. Nothing to do.");
  } else {
    console.log(
      `Paused ${paused.length} seed listing(s). Production Explore stays empty until real hosts publish.`,
    );
  }
  process.exit(0);
}
