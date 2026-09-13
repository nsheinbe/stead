/**
 * Slice 1 demo inventory — Nora and six picsum homes.
 *
 * Local and staging use these rows so Explore is not empty. Production must
 * not present them as live bookable homes: the public catalog and booking
 * paths treat the known ids as absent unless ALLOW_DEMO_LISTINGS=1.
 *
 * No migration deletes production rows. Neon journal history has been
 * unfriendly to one-shot data rewrites; hiding in the app is the safer
 * default. `npm run db:seed` is documented as local/staging only.
 */
export const SEED_HOST_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
export const SEED_HOST_EMAIL = "nora@stead.example";

export const SEED_LISTING_IDS = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
  "44444444-4444-4444-4444-444444444444",
  "55555555-5555-5555-5555-555555555555",
  "66666666-6666-6666-6666-666666666666",
] as const;

export type SeedListingId = (typeof SEED_LISTING_IDS)[number];

export class SeedProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedProductionError";
  }
}

type Env = Record<string, string | undefined>;

function readFlag(env: Env): "on" | "off" | "unset" {
  const raw = env.ALLOW_DEMO_LISTINGS?.trim();
  if (raw === "1") return "on";
  if (raw === "0") return "off";
  return "unset";
}

function looksLikeOpensteadProduction(env: Env): boolean {
  const urls = [env.APP_URL, env.AUTH_URL, env.VERCEL_PROJECT_PRODUCTION_URL];
  return urls.some((value) => (value ?? "").toLowerCase().includes("openstead.app"));
}

/**
 * Whether the six demo homes may appear as public, bookable listings.
 *
 * ALLOW_DEMO_LISTINGS=1 wins (preview / laptop / staging).
 * ALLOW_DEMO_LISTINGS=0 always hides them.
 * Otherwise hidden on Vercel production or NODE_ENV=production.
 */
export function allowDemoListings(env: Env = process.env): boolean {
  const flag = readFlag(env);
  if (flag === "on") return true;
  if (flag === "off") return false;
  if (env.VERCEL_ENV === "production") return false;
  if (env.NODE_ENV === "production") return false;
  return true;
}

export function isSeedListingId(listingId: string): boolean {
  return (SEED_LISTING_IDS as readonly string[]).includes(listingId);
}

export function isSeedHostId(memberId: string): boolean {
  return memberId === SEED_HOST_ID;
}

/** Seed rows that must not be sold as live inventory in this process. */
export function isHiddenSeedListing(listingId: string, env: Env = process.env): boolean {
  return !allowDemoListings(env) && isSeedListingId(listingId);
}

/**
 * `npm run db:seed` writes the demo host as active. Refuse when the process
 * is clearly aimed at production, unless the operator opted in.
 */
export function assertDemoSeedAllowed(env: Env = process.env): void {
  if (readFlag(env) === "on") return;
  const production =
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    looksLikeOpensteadProduction(env);
  if (!production) return;
  throw new SeedProductionError(
    "npm run db:seed writes demo homes (Nora + six picsum listings). " +
      "That is for local and staging databases only. Production Explore " +
      "hides those ids even if the rows exist. To seed a preview or staging " +
      "database on purpose: ALLOW_DEMO_LISTINGS=1 npm run db:seed",
  );
}
