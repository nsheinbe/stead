# Backup and restore — Neon Postgres

Neon keeps a change history on the project (instant restore / point-in-time recovery) and you can take your own `pg_dump` copies for disaster recovery or compliance. Use both. This is not a second hosted database product and it is not a protocol.

Official overview: [Neon backups](https://neon.com/docs/postgres/backup-restore/backups).

## What to protect

| Store | What is in it | How it is backed up |
| --- | --- | --- |
| Neon Postgres (default branch) | members, listings, bookings, escrow, claims, reviews, identity tables, heartbeats | Neon history window + `pg_dump` |
| Neon preview branches | disposable clones | recreate from parent; do not treat as a backup |
| S3-compatible bucket (`S3_*`) | listing photos, claim evidence | the bucket provider's versioning / replication |
| Vercel env | secrets | Vercel project settings — not in git |

Picsum URLs in seed data are not ours to back up. Once hosts upload real photography, the bucket is.

## 1. Instant restore (point-in-time)

Neon retains a history window (plan-dependent, up to 30 days). You can restore the default branch to any moment in that window, or create a new branch from a past timestamp, without a dump file.

Set the history window in the Neon console (project → Settings → Restore). Longer windows cost storage. For production, use at least 7 days.

**Restore into a new branch first. Never restore over production until you have seen the data.**

```bash
# Console: Branches → New branch → timestamp, or:
neon branches create --name recover-YYYYMMDD --parent production --timestamp "2026-09-08T16:00:00Z"
```

Then:

1. Point a throwaway Vercel preview (or `npm run dev`) at that branch's `app_user` URL.
2. Confirm the rows you expected are back — and that `app_user` still cannot bypass RLS (`npm run verify:neon`).
3. If the restore is the new production, follow Neon's [instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore) promote path (or dump from the recovery branch and restore onto a fresh production branch). Instant restore rewrites the branch it targets; treat that as the dangerous step.

Time Travel (read-only query against a past timestamp) is useful for "what did this booking look like at 16:00 listing time?" without making a branch. See [Time Travel](https://neon.com/docs/postgres/backup-restore/time-travel-assist).

## 2. `pg_dump` / `pg_restore` (portable copy)

Use the **direct** owner URL. The pooled host is PgBouncer in transaction mode and will fight a dump.

```bash
# Dump (custom format, compressed). Owner, direct host, no secrets in the file name.
pg_dump "$DATABASE_URL_OWNER" \
  --format=custom --no-owner --no-acl \
  --file="stead-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Restore onto an empty database (new Neon branch, or local Docker).
pg_restore --dbname="$DATABASE_URL_OWNER" --no-owner --no-acl --verbose stead-….dump
```

After a restore onto a fresh branch:

```bash
npm run db:migrate          # no-ops if the dump already has the schema
npm run db:bootstrap-roles  # passwords are not in the dump; set them again
npm run verify:neon
```

`--no-owner --no-acl` keeps the dump from trying to recreate Neon-internal roles. Our `app_user` / `auth_user` grants live in `drizzle/0002_roles_and_rls.sql` and later migrations — re-applying migrations after restore is the safe way to get them back if the dump skipped ACLs.

Do not commit dump files. Store them in an access-controlled bucket with a retention policy.

Neon documents a nightly `pg_dump` → S3 GitHub Action if you want that automation: [part 1](https://neon.com/docs/manage/backups-aws-s3-backup-part-1), [part 2](https://neon.com/docs/manage/backups-aws-s3-backup-part-2).

## 3. Object storage

Listing photos and claim evidence are objects in whatever S3 API `S3_*` points at (AWS S3, R2, B2, MinIO locally). Neon Postgres does not store the bytes.

- Enable versioning on the production bucket.
- Replicate or copy to a second region if the provider supports it.
- A database restore without the matching objects leaves `listing_photos.storage_path` and `claim_evidence.storage_path` pointing at missing files. Restore the bucket to the same moment as the database, or accept broken images.
- MinIO in `docker compose --profile storage` is local-only. It is not a backup of production.

If you later move objects onto Neon Object Storage, that product branches with the database. Until then, the bucket is a separate restore step.

## 4. What a restore does not bring back

- Stripe PaymentIntents, SetupIntents, refunds, Identity sessions — those live at Stripe. A restored booking may reference an intent that still exists (good) or one that has since settled differently (reconcile by hand).
- Auth.js magic-link mail is ephemeral. Sessions are JWTs in cookies; members sign in again if you rotated `AUTH_SECRET`.
- Vercel deployments and env values — export them from the Vercel project if you need an off-platform copy of the variable *names*. Never write secret values into this repo.

## 5. Drill

Once, before launch, on a throwaway Neon branch:

1. `pg_dump` production (or a copy).
2. Restore onto the throwaway branch.
3. `npm run db:bootstrap-roles && npm run verify:neon`.
4. Sign in, open a known trip, confirm the deposit chip and a listing photo (or its missing-image state).
5. Delete the throwaway branch.

Write down how long the dump took and where you put it. That is the runbook working.
