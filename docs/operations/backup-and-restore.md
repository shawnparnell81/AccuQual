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
| Secrets (`.env`: JWT secrets, `TENANT_AI_CONFIG_ENCRYPTION_KEY`, email token, database URL) | Your hosting accounts / password manager | **No** — keep a copy somewhere else |
| Queues, rate-limit counters, worker heartbeats | Redis | No, and not needed: it is rebuilt. Workflow runs in flight at the moment of loss are the only thing that can be lost |

Two things that surprise people:

1. **Without `TENANT_AI_CONFIG_ENCRYPTION_KEY` the restored database cannot decrypt any organization's saved AI
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

Step 4 is not optional. Until it runs, the restored database has none of the tenant-isolation policies enforced for
the application role, because `--no-privileges` deliberately left the grants behind.

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

1. `npm run db:verify-restore` passes, or (no original available) `select count(*)` on `users`, `tenants` and a few
   record tables looks right.
2. Point the API at the restored database (`DATABASE_URL`), start it, and check `GET /health` reports the database `ok`.
3. Sign in as an administrator. Open a record list and confirm you see only your own organization's records.
4. Confirm the audit log is still append-only (an attempted delete by the application role must be refused).
5. Restore the uploaded-files folder to `STORAGE_LOCAL_PATH` and open an attachment.
6. Put the secrets back (especially `TENANT_AI_CONFIG_ENCRYPTION_KEY`).
7. Restart the three workers. Anything mid-run when the loss happened will not resume; re-trigger it.
8. Record the incident and the data-loss window (the time between the backup and the failure) for affected customers.

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
  schedule. Nothing runs a scheduled dump today. For platform backups it is whatever your Supabase plan provides
  **[confirm]**.

## What is still unproven

- Restoring from **Supabase's own** backup (daily backup or point-in-time recovery) has not been tried.
- The drill was run on a copy of the demo dataset, at small scale.
- Restoring the uploaded-files folder has not been drilled (it is a plain folder copy, but untested).
- No scheduled off-platform backup exists yet. Suggested next step: a nightly `pg_dump` to encrypted storage you control,
  with an alert when it fails, plus a repeat of this drill quarterly.

## Cleaning up after a drill

A drill database holds a full copy of real (or demo) customer data. Delete the scratch container and every dump file
when finished: `docker rm -f restore-pg`, then delete the `.dump` file and any export ZIP.
