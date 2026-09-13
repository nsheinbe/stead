import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  assertDemoSeedAllowed,
  DEMO_SEED_REFUSAL,
  demoSeedAllowed,
  HOST_EMAIL,
  HOST_ID,
  SEED_LISTING_IDS,
} from "../scripts/seed";
import { pauseSeedListings } from "../scripts/pause-seed-listings";
import {
  asOwner,
  closeTestDb,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(root, "node_modules/.bin/tsx");

describe("demo seed gate", () => {
  it("names the six Slice-1 listing ids operators already paused in prod", () => {
    expect(SEED_LISTING_IDS).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555",
      "66666666-6666-6666-6666-666666666666",
    ]);
    expect(HOST_ID).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(HOST_EMAIL).toBe("nora@stead.example");
  });

  it("refuses NODE_ENV=production even when ALLOW_DEMO_SEED is set", () => {
    expect(demoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" })).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: "PRODUCTION", ALLOW_DEMO_SEED: "true" })).toBe(false);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" })).toThrow(
      DEMO_SEED_REFUSAL,
    );
  });

  it("refuses when ALLOW_DEMO_SEED is unset or not a clear yes", () => {
    expect(demoSeedAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: "test", ALLOW_DEMO_SEED: "0" })).toBe(false);
    expect(demoSeedAllowed({ ALLOW_DEMO_SEED: "no" })).toBe(false);
    expect(() => assertDemoSeedAllowed({})).toThrow(/ALLOW_DEMO_SEED=1/);
  });

  it("allows a non-production database only with an explicit opt-in", () => {
    expect(demoSeedAllowed({ ALLOW_DEMO_SEED: "1" })).toBe(true);
    expect(demoSeedAllowed({ NODE_ENV: "development", ALLOW_DEMO_SEED: "true" })).toBe(true);
    expect(demoSeedAllowed({ NODE_ENV: "test", ALLOW_DEMO_SEED: "yes" })).toBe(true);
    expect(() => assertDemoSeedAllowed({ ALLOW_DEMO_SEED: "1" })).not.toThrow();
  });

  it("CLI refuses in production before touching the database", () => {
    const result = spawnSync(tsx, ["scripts/seed.ts"], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        ALLOW_DEMO_SEED: "1",
        DATABASE_URL_OWNER: "postgres://nobody@127.0.0.1:1/nope",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Refusing to seed demo listings");
  });
});

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("pause seed listings", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("pauses the known ids under the seed host and is idempotent", async () => {
    await insertMember(HOST_ID, HOST_EMAIL, "Nora", true);
    for (const listingId of SEED_LISTING_IDS) {
      await insertListing({
        id: listingId,
        hostId: HOST_ID,
        status: "active",
        city: "SeedvilleDemo",
      });
    }
    const seedIdList = sql.join(
      SEED_LISTING_IDS.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await asOwner(async (db) => {
      await db.execute(sql`
        UPDATE public.listings
           SET status = 'active'
         WHERE host_id = ${HOST_ID}::uuid
           AND id IN (${seedIdList})
      `);
    });

    const first = await asOwner((db) => pauseSeedListings(db));
    expect(first.sort()).toEqual([...SEED_LISTING_IDS].sort());

    const statuses = await asOwner(async (db) => {
      const rows = (await db.execute<{ status: string }>(sql`
        SELECT status::text
          FROM public.listings
         WHERE id IN (${seedIdList})
      `)) as unknown as { status: string }[];
      return rows.map((row) => row.status);
    });
    expect(statuses).toEqual(SEED_LISTING_IDS.map(() => "paused"));

    const second = await asOwner((db) => pauseSeedListings(db));
    expect(second.sort()).toEqual([...SEED_LISTING_IDS].sort());
  });
});
