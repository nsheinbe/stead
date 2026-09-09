/**
 * Trust Passport reads. trust_stats is an owner-security view, so these
 * aggregates are public even when the underlying bookings are not.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import type { Passport, TrustStats } from "../../src/lib/types";
import { listPublishedReviewsForSubject } from "./reviews";

function mapStats(row: {
  profile_id: string;
  stays_completed: number;
  damage_free_streak: number;
  avg_rating_as_guest: string | number | null;
  avg_rating_as_host: string | number | null;
  review_count: number;
  response_rate: string | number | null;
  host_cancellations: number;
  verification_tier: number;
  member_since: string;
}): TrustStats {
  return {
    profileId: row.profile_id,
    staysCompleted: Number(row.stays_completed),
    damageFreeStreak: Number(row.damage_free_streak),
    avgRatingAsGuest: row.avg_rating_as_guest == null ? null : Number(row.avg_rating_as_guest),
    avgRatingAsHost: row.avg_rating_as_host == null ? null : Number(row.avg_rating_as_host),
    reviewCount: Number(row.review_count),
    responseRate: row.response_rate == null ? null : Number(row.response_rate),
    hostCancellations: Number(row.host_cancellations),
    verificationTier: Number(row.verification_tier),
    memberSince: new Date(row.member_since).toISOString(),
  };
}

export async function getTrustStats(tx: Tx, profileId: string): Promise<TrustStats | null> {
  const rows = (await tx.execute(sql`
    SELECT profile_id, stays_completed, damage_free_streak,
           avg_rating_as_guest, avg_rating_as_host, review_count,
           response_rate, host_cancellations, verification_tier, member_since
      FROM public.trust_stats
     WHERE profile_id = ${profileId}::uuid
  `)) as unknown as {
    profile_id: string;
    stays_completed: number;
    damage_free_streak: number;
    avg_rating_as_guest: string | number | null;
    avg_rating_as_host: string | number | null;
    review_count: number;
    response_rate: string | number | null;
    host_cancellations: number;
    verification_tier: number;
    member_since: string;
  }[];
  return rows[0] ? mapStats(rows[0]) : null;
}

export async function getPassport(tx: Tx, profileId: string): Promise<Passport | null> {
  const rows = (await tx.execute(sql`
    SELECT p.id, p.display_name, p.avatar_url, p.is_host,
           (SELECT l.city FROM public.listings l
             WHERE l.host_id = p.id AND l.status = 'active'
             ORDER BY l.title ASC LIMIT 1) AS city,
           (SELECT l.region FROM public.listings l
             WHERE l.host_id = p.id AND l.status = 'active'
             ORDER BY l.title ASC LIMIT 1) AS region
      FROM public.profiles p
     WHERE p.id = ${profileId}::uuid
  `)) as unknown as {
    id: string;
    display_name: string;
    avatar_url: string | null;
    is_host: boolean;
    city: string | null;
    region: string | null;
  }[];
  const profile = rows[0];
  if (!profile) return null;

  const stats = await getTrustStats(tx, profileId);
  if (!stats) return null;

  const reviews = await listPublishedReviewsForSubject(tx, profileId);

  return {
    profileId: profile.id,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    isHost: profile.is_host,
    city: profile.city,
    region: profile.region,
    stats,
    reviews,
  };
}
