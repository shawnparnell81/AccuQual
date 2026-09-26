# Backup and restore

What is backed up, how to take your own backup, how to restore it, and how to prove the restore is right.

**Status of the evidence.** On 2026-09-20 a logical backup (`pg_dump`) of the live Supabase database was restored into
a brand-new PostgreSQL 17 server, migrated, checked, and run under the real API. Every check passed (results below).
That proves *the procedure in this file works*. It does **not** prove Supabase's own platform backups can be restored:
that path has not been exercised (see [What is still unproven](#what-is-still-unproven)).

## What holds your data

| Data | Where it lives | Covered by a database backup? |
|---|---|---|
| Records, users, audit history, workflow definitions, settings | PostgreSQL (`public` schema) | Yes |
| Migration history | PostgreSQL (`drizzle` schema) | Yes — **must be included**, see below |
| Uploaded files (attachments, certificates, PDFs) | `STORAGE_LOCAL_PATH` (a Docker volume, or a persistent disk on Render) | **No** — back this folder up separately |
| Secrets (`.env`: JWT secrets, `AI_CONFIG_ENCRYPTION_KEY`, email token, database URL) | Your hosting accounts / password manager | **No** — keep a copy somewhere else |
| Queues, rate-limit counters, worker heartbeats | Redis | No, and not needed: it is rebuilt. Workflow runs in flight at the moment of loss are the only thing that can be lost |

Two things that surprise people:

1. **Without `AI_CONFIG_ENCRYPTION_KEY` the restored database cannot decrypt any organization's saved AI
   provider key.** Losing that key is not fatal (organizations re-enter their key) but it is avoidable: store it with
   the other secrets.
2. **A backup of only the `public` schema restores the data but breaks migrations.** `npm run db:migrate` then tries to
   re-run every migration from the start and fails with `role ... already exists`. Always dump the `drizzle` schema too.

## Platform backups (Supabase)

Supabase takes its own backups of the project. **[confirm your plan: daily backups vs. point-in-time recovery, and the
retention period, in the Supabase dashboard → Database → Backups]** and record the answer here and in
`docs/privacy/data-handling-summary.md`. Platform backups are the fastest way to recover from a bad deploy, and the
manual backup below is your protection against losing the platform account or project itself, so keep both.

## Taking a backup yourself

Needs Docker (or a local PostgreSQL 17 client) and the database URL (`DATABASE_URL` from the root `.env`).

```sh
# Dump the application schema AND the migration history. Custom format is compressed and restores selectively.
docker run --rm -e DBURL="<database url>" -v "$PWD:/out" pgvector/pgvector:pg17 \
  sh -c 'pg_dump "$DBURL" --format=custom --schema=public --schema=drizzle --no-owner --no-privileges --file=/out/accuqual-$(date +%Y%m%d-%H%M).dump'
```

- `--no-owner --no-privileges` are deliberate: Supabase's role names and grants do not exist elsewhere. The
  application's own role (`accuqual_app`), its grants and every security policy are recreated by `npm run db:migrate`
  after the restore, from files in this repository — so a restored database ends up with exactly the current rules,
  not a stale copy of them.
- Use the `pgvector/pgvector:pg17` image (or any client at least as new as the server); an older `pg_dump` refuses a
  newer server.
- Also copy the uploaded-files folder, and store both **encrypted and off the platform**.

**Where not to keep a dump.** A dump contains every organization's data, including password hashes and audit history.
Never commit it, and never attach it to a GitHub Actions run or release: this repository is public. Use an encrypted
disk or an encrypted cloud bucket you control, with the same retention as your published backup-retention statement.

## Restoring

Restore into an **empty** database. Never restore over a live one.

```sh
# 1. A fresh PostgreSQL 17 with pgvector (local drill shown; on a real recovery this is your new database host)
docker run -d --name restore-pg -e POSTGRES_USER=accuqual -e POSTGRES_PASSWORD=<pick one> -p 5544:5432 pgvector/pgvector:pg17
docker exec restore-pg psql -U accuqual -d postgres -c "create database accuqual_restore"

# 2. The vector extension must exist first (embedding columns use it)
docker exec restore-pg psql -U accuqual -d accuqual_restore -c "create extension if not exists vector"

# 3. Restore. Skip creating the `public` schema, which already exists in a new database.
docker cp accuqual-YYYYMMDD-HHMM.dump restore-pg:/tmp/a.dump
docker exec restore-pg sh -c 'pg_restore -l /tmp/a.dump | grep -vE " SCHEMA - public| COMMENT - SCHEMA public" > /tmp/a.list
  pg_restore --no-owner --no-privileges --exit-on-error -L /tmp/a.list -U accuqual -d accuqual_restore /tmp/a.dump'

# 4. Recreate the application role, grants, row-level-security policies, audit triggers and indexes
cd services/api
DATABASE_URL=postgres://accuqual:<pw>@localhost:5544/accuqual_restore npm run db:migrate
```

Step 4 is not optional. Until it runs, the restored database has none of the grants or policies the application role
needs (including its append-only limits on the audit tables), because `--no-privileges` deliberately left the grants behind.

On Windows Git Bash prefix the `docker exec`/`cp` lines with `MSYS_NO_PATHCONV=1`, otherwise `/tmp/...` is rewritten
into a Windows path.

### Prove it worked

```sh
cd services/api
SOURCE_DATABASE_URL=<the original>  DATABASE_URL=<the restored copy>  npm run db:verify-restore
```

Read-only on both sides. It compares the number of tables, columns, indexes, constraints, triggers, functions,
sequences, security policies, and security-enabled tables; that the `accuqual_app` role exists and can read every
table; the `vector` extension; **the exact row count of every table**; and that every id sequence is ahead of its data
(otherwise the next insert collides with an existing row). It exits non-zero on any difference. When the original is
gone (a real disaster), run it against a second copy, or use the checklist below instead.

### After a real restore

1. `npm run db:verify-restore` passes, or (no original available) `select count(*)` on `users`, `company` and a few
   record tables looks right.
2. Point the API at the restored database (`DATABASE_URL`), start it, and check `GET /health` reports the database `ok`.
3. Sign in as an administrator. Open a record list and confirm the records you expect are there.
4. Confirm the audit log is still append-only (an attempted delete by the application role must be refused).
5. Restore the uploaded-files folder to `STORAGE_LOCAL_PATH` and open an attachment.
6. Put the secrets back (especially `AI_CONFIG_ENCRYPTION_KEY`).
7. Restart the three workers. Anything mid-run when the loss happened will not resume; re-trigger it.
8. Record the incident and the data-loss window (the time between the backup and the failure) for affected customers.

## Automated nightly backup

**Status: running.** Set up on 2026-09-20 with a private Cloudflare R2 bucket (`accuqual-nightly`). A manual run on
GitHub's runners succeeded that day, and a restore drill from the bucket passed. The setup steps below are kept so the
whole thing can be rebuilt (a new bucket, a rotated key) without guesswork. If a secret is ever missing, a run fails with
a message naming exactly which one.

**What it does.** `.github/workflows/backup.yml` runs every night at 07:23 UTC on a GitHub-hosted runner (so it does not
depend on your laptop being on). It uses `ops/backup/backup.mjs` inside `ops/backup/Dockerfile` (PostgreSQL 17 tools) to:

1. Export one database snapshot and dump the `public` and `drizzle` schemas from **that same snapshot**, and count every
   table's rows inside it, so the manifest is exactly what the dump contains.
2. Refuse to store it if it is obviously the wrong database (fewer than 20 tables or under 50 KB).
3. Bundle dump + manifest, **encrypt with AES-256** (key derived from `BACKUP_PASSPHRASE`), and decrypt it again to prove the
   ciphertext round-trips before anything is uploaded. The bucket only ever holds ciphertext.
4. Upload to your bucket and confirm the stored size. Every night goes in `daily/`; Sundays also in `weekly/`; the 1st also
   in `monthly/`. Retention: 14 daily, 8 weekly, 12 monthly (`BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`). Pruning only ever deletes
   files this tool named, never the newest, and never anything else in the bucket.
5. Ping a dead-man switch URL (`BACKUP_HEARTBEAT_URL`) on success and `/fail` on failure. A failed run also emails you
   through GitHub's normal failed-workflow notification.

On the 1st of each month a second job, **restore drill**, downloads the newest backup, decrypts it, restores it into a
scratch PostgreSQL, runs `db:migrate`, and verifies it against the backup's manifest (structure, security policies, app-role
access, exact row count of every table). No production database is touched. A backup you have never restored is a hope.

### One-time setup

1. **A private bucket you control**, off the platforms that host the app: Cloudflare R2 or Backblaze B2 (both have a free tier
   far larger than these backups) or any S3-compatible store. Keep public access off. Create an access key limited to that
   one bucket with read, write and delete (delete is needed for retention pruning).
2. **A passphrase**, generated once: `openssl rand -base64 33`. Store it in your password manager **and** one offline copy.
   **If it is lost, every backup is permanently unreadable**; there is no recovery. It must not live only in GitHub.
3. **The database URL for the runner.** Use Supabase's **Session pooler** connection string (IPv4; GitHub's runners cannot use
   the direct IPv6 one, the same rule as the Render deploy in DEPLOY.md). `pg_dump` needs a session-mode connection, not the
   transaction pooler. The role must be able to read every table through row-level security (the Supabase `postgres` role can).
4. **An optional Healthchecks.io check** for the backup (period 1 day, grace ~3 hours): its ping URL is `BACKUP_HEARTBEAT_URL`.
   Use a *separate* check from the API's `HEARTBEAT_URL`. This is what tells you when a night is *skipped*, not only failed.
5. **Repository secrets** (Settings, Secrets and variables, Actions; or `gh secret set NAME`):

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the Session pooler connection string |
| `BACKUP_PASSPHRASE` | the passphrase from step 2 |
| `BACKUP_S3_BUCKET` | bucket name |
| `BACKUP_S3_ENDPOINT` | the provider's S3 endpoint (R2: `https://<account>.r2.cloudflarestorage.com`; B2: `https://s3.<region>.backblazeb2.com`); leave unset for AWS S3 |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | the bucket-scoped key |
| `BACKUP_S3_REGION` | optional; defaults to `auto` (R2). Set it for AWS S3 / B2 (e.g. `us-west-004`) |
| `BACKUP_HEARTBEAT_URL` | optional, from step 4 |

6. **Prove it**: Actions, **Backup**, *Run workflow*, `backup`; then again with `restore-drill`. Both should go green. Do
   this before relying on it, and note the drill's own timing here.

### Getting a backup back

```sh
# any machine with Docker; the same variables as the secrets above
docker build -f ops/backup/Dockerfile -t accuqual-backup .
docker run --rm -e BACKUP_PASSPHRASE -e BACKUP_S3_BUCKET -e BACKUP_S3_ENDPOINT -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  -v "$PWD/out:/out" --user "$(id -u):$(id -g)" accuqual-backup fetch latest --out /out     # or: fetch <key> --tier weekly
# -> out/accuqual.dump (checksum-verified) and out/manifest.json; then follow "Restoring" above.
# Whole recovery rehearsal in one command (scratch database, nothing else touched):
bash ops/backup/restore-drill.sh latest daily
```

Without this repository: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in X.tar.enc -out X.tar && tar -xf X.tar`.
After restoring, verify with the manifest instead of the (gone) original. A backup is usually older than the newest
migration in the repository, so check the data **before** `db:migrate` and the application role **after** it:

```sh
cd services/api
MANIFEST_FILE=../../out/manifest.json DATABASE_URL=<restored> VERIFY_PHASE=data  npm run db:verify-restore   # right after pg_restore
DATABASE_URL=<restored> npm run db:migrate
MANIFEST_FILE=../../out/manifest.json DATABASE_URL=<restored> VERIFY_PHASE=roles npm run db:verify-restore   # after migrating
```

`ops/backup/restore-drill.sh` does exactly this sequence. Without `VERIFY_PHASE` both checks run together, which is only
meaningful when the backup and the repository are at the same migration.

### Limits, stated plainly

- **Data-loss window: up to ~24 hours** (nightly). Supabase's own backups may be finer-grained **[confirm your plan]**.
- **Uploaded files and `.env` secrets are not in it** (see the table at the top). Only the database is.
- **The GitHub secrets hold a powerful database credential and a bucket key that can delete backups.** Only repository
  administrators can read or change secrets, and pull requests from forks never receive them, but treat repository admin access
  accordingly. To limit damage from a compromised bucket key, turn on the provider's object versioning or object lock.
- GitHub **pauses scheduled workflows after 60 days without repository activity**; that is what the heartbeat is for.
- Proven so far: a real backup of the live Supabase database into the real R2 bucket (locally and on GitHub's runners), and
  a restore drill from that bucket (download, decrypt, restore, verify: 14 s). The **scheduled** monthly drill job has not
  run yet (first on 2026-10-01); it can be started by hand from Actions, Backup, Run workflow, `restore-drill`.

## The drill of 2026-09-20 — what was actually run

Source: the live Supabase database (demo data). Target: a new `pgvector/pgvector:pg17` container on the same laptop.

| Step | Result |
|---|---|
| `pg_dump` (public + drizzle) | 14 s including container start, 607 KB |
| `pg_restore` into an empty database | 3 s |
| `npm run db:migrate` on the restored copy | 2 s; all 61 recorded migrations recognised, nothing re-run; role, grants, policies, triggers, indexes recreated |
| `db:verify-restore` | **All 14 checks PASS**: 102 tables, 1,277 columns, 282 indexes, 399 constraints, 65 triggers, 121 functions, 102 sequences, 105 policies, 102 tables with row-level security, app role + read access to 102 tables, `vector` extension, **1,607 rows identical across all 102 tables**, no sequence behind its data |
| Real API started against the restored copy | `/health` ok; sign-in worked; an admin saw only their own organization's rows (organization 2 saw none of organization 1's, an unknown organization saw 0 users); a write fired the audit trigger; an attempted `DELETE` on the audit trail by the application role was refused; a full data export returned 99 files with a manifest |

Two problems the drill found and this file now prevents: the first dump left out the `drizzle` schema (migrations
failed on the restored copy), and the verifier's own privilege check could error once the `drizzle` schema was present.

### Recovery time and data loss, honestly

- **Restore time.** About 20 seconds of work for this dataset (~1,600 rows, 600 KB). That is a *floor*, not a
  promise: a production database with years of records and thousands of attachments will take proportionally longer
  and the drill has not measured it. Re-run the drill against real production size before quoting a recovery time to a
  customer. What a real recovery adds on top is human time: provisioning the new database host, updating the
  connection settings, and running the checklist — plan on an hour, not seconds.
- **Data-loss window (RPO).** For a manual backup it is the age of your newest dump, so it is exactly as good as your
  schedule. The automated nightly backup (above) makes it at most about 24 hours once it is switched on. For platform backups it is whatever your Supabase plan provides
  **[confirm]**.

## What is still unproven

- Restoring from **Supabase's own** backup (daily backup or point-in-time recovery) has not been tried.
- The drill was run on a copy of the demo dataset, at small scale.
- Restoring the uploaded-files folder has not been drilled (it is a plain folder copy, but untested).
- The nightly job's skipped-night alert (Healthchecks, `BACKUP_HEARTBEAT_URL`) is not connected yet, so a *failed* night
  emails you but a *skipped* night is silent. The uploaded-files folder is not backed up yet.

## Cleaning up after a drill

A drill database holds a full copy of real (or demo) customer data. Delete the scratch container and every dump file
when finished: `docker rm -f restore-pg`, then delete the `.dump` file and any export ZIP.
