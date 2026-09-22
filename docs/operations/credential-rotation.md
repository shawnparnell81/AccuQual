# Credential rotation

When to rotate: a credential appeared in a chat, a screenshot, a shared
document, or anywhere else outside its intended storage — GitHub Secrets,
`.env` files, or a password manager. Treat "it was pasted somewhere it
shouldn't have been" as compromised even if nothing bad has happened yet;
rotate on that basis alone, don't wait for evidence of misuse.

**Golden rule for every rotation below: generate the new value from the
provider's own "generate" button, or `openssl rand`, never by hand-typing
a variant of the old one.** Appending a character to an old, exposed
password produces a new value that still contains the exposed one as a
substring — not a real rotation.

**Secrets never go in chat.** The pattern that works: put the new value
in a plain-text file on the Desktop, tell Claude the file's path, Claude
reads it, applies it, and deletes any temp copy it made along the way.

## Where each credential lives

| Credential | Lives in | Also update |
|---|---|---|
| Supabase database password | `DATABASE_URL` in root `.env` | GitHub secret `BACKUP_DATABASE_URL`; recreate `api` + all 3 workers |
| Cloudflare R2 access key / secret | GitHub secrets `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | nothing local — only the nightly backup workflow uses these |
| Backup encryption passphrase | GitHub secret `BACKUP_PASSPHRASE`; a copy on the Desktop | **Do not rotate casually** — see below |
| SMTP / ZeptoMail password | `SMTP_PASSWORD` in `services/api/.env` (and root `.env`'s `ZEPTOMAIL_SEND_TOKEN` if that's the transport in use) | Whichever containers send email |
| JWT / encryption secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TENANT_AI_CONFIG_ENCRYPTION_KEY`) | root `.env` (Render: `generateValue: true`, no action needed there) | Rotating `TENANT_AI_CONFIG_ENCRYPTION_KEY` invalidates every tenant's stored BYOK key — see the warning below |

## Rotating the Supabase database password

1. Supabase dashboard → the project → **Database** → **Settings** (not
   the old "Project Settings" location — Supabase has moved this before).
   Click **Reset database password**, then **Generate a password** —
   don't type one.
2. Save it to a Desktop text file, tell Claude the path.
3. Claude tests the new password against the database *before* writing
   it anywhere (a bad password bricks every container that reads
   `DATABASE_URL`), then:
   - updates `DATABASE_URL` in the root `.env`,
   - updates the GitHub secret `BACKUP_DATABASE_URL`,
   - `docker compose up -d --force-recreate api ai-worker workflow-worker digital-twin-worker`,
   - confirms `/health` returns 200 and a login round-trips,
   - confirms the old password is now rejected,
   - runs a backup workflow to confirm the new database URL works there too.
4. Delete the Desktop file once the value is in your password manager.

## Rotating the R2 (Cloudflare) key

1. Cloudflare dashboard → R2 → **Manage API tokens** → create a new token
   scoped to **Object Read & Write** on the `accuqual-nightly` bucket only
   (not account-wide).
2. Save both values (Access Key ID, Secret Access Key) to a Desktop file,
   tell Claude the path.
3. Claude tests the new key can list/write/delete in the bucket *before*
   changing secrets, then sets `BACKUP_S3_ACCESS_KEY_ID` /
   `BACKUP_S3_SECRET_ACCESS_KEY`, triggers a backup run, confirms it's
   green.
4. **Only then** delete the old token in Cloudflare. Confirm it's rejected
   (a `docker run amazon/aws-cli ... s3 ls` with the old key should now
   fail with `Unauthorized`) before considering the rotation done —
   deleting a token in the UI doesn't always take effect instantly.
5. Delete the Desktop file(s) once the value is in your password manager.

## The backup passphrase — different rules

This is **not** rotated the same casual way. It's the AES-256 key every
existing backup in R2 was encrypted with. Changing `BACKUP_PASSPHRASE`
without a plan means every backup taken before the change becomes
permanently unreadable the moment the daily/weekly/monthly retention
window ages the old ones out — there is no way to re-encrypt a backup
already sitting in R2.

- If it was only ever pasted into a chat as a *proposed* value and never
  actually set as the real secret, no rotation is needed — the real
  passphrase (the one actually protecting real backups) was never
  exposed.
- If the real, in-use passphrase is genuinely exposed, the safe sequence
  is: generate a new one (`openssl rand -base64 33`), keep the **old**
  one recorded somewhere safe as well, take a backup under the new
  passphrase, and only discard the old one once every backup that used
  it has aged out of retention (14 daily / 8 weekly / 12 monthly) or
  you've deliberately migrated the older ones.
- Store the current passphrase in a password manager **and** an offline
  copy (printed, or on a drive that isn't networked) — it's the one
  credential where "only in the password manager" isn't enough, because
  losing access to the password manager itself would make every backup
  unreadable with no recovery path.

## After any rotation

- Confirm the app still works (`/health`, a real login) before calling it
  done.
- Confirm a backup run is still green.
- Delete every Desktop file that held a credential in plain text, once
  it's safely in a password manager.
- Update this repo's memory / whatever tracks "what's pending" so a
  half-finished rotation (new key set, old key not yet deleted) doesn't
  get lost.
