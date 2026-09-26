# Deploying AccuQual

Everything in this file has been proven against the real infrastructure it
describes — a real Supabase project, and the real Docker images this repo
already builds — not written from theory. The private Render blueprint
(`render.yaml`) is two services, API and web, with the URLs pasted in the
dashboard rather than wired with `fromService`. Redis and the three
workers are not in that blueprint; their definitions are kept in
`render.workers.yaml` and have not been applied to a live Render account
(the worker images themselves do build in CI).

## The one gotcha that will bite you if you skip this section

**Supabase's "Direct connection" string will not work from most hosting
platforms, including Render.** It resolves to an IPv6-only address, and
most container platforms (this one's local Docker included) don't route
IPv6 egress. Symptom: `connect ENETUNREACH <ipv6 address>:5432`.

**Fix: use the Session Pooler connection string, not Direct connection.**
In Supabase → your project → Connect → Direct Connection string tab →
Connection Method → **Session pooler**. It looks like:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Session pooler, not Transaction pooler — every request runs in one
transaction that does `SET LOCAL ROLE accuqual_app` (see
`src/lib/requestDb.ts`), which Session pooler supports and Transaction
pooler is not guaranteed to. Only Session pooler is recommended.

## What's already proven, live, against the real Supabase project

- Full schema + the restricted database role (`accuqual_app`) + pgvector + all
  indexes deploy cleanly via the existing `npm run db:migrate`.
- The append-only audit tables are enforced by the database role switch, and
  Supabase's anon/authenticated roles are locked out of every table, over the
  network exactly as locally.
- The full automated test suite passes against a real Postgres database.
- The actual production Docker image (`services/api/Dockerfile`) boots
  correctly against Supabase via the Session Pooler, a real login
  round-trips correctly, and the role switch works through the pooler.
- The production boot guard correctly refuses to start with a default
  encryption key when `NODE_ENV=production` (tested deliberately) — and
  correctly stays quiet when given a real one.
- Supabase's own security linter (Advisor) went from 4 CRITICAL findings
  to "no issues found" after `db:migrate`'s Supabase-lockdown step ran
  (revokes the anon/authenticated access Supabase grants by default —
  see `services/api/src/drizzle/post-migrate/supabase-lockdown.sql`).

## Working safely once real customers use it

Two rules keep new work from hurting live data or live customers.

### 1. Build and test on a local database, never on the live one

The root `.env` points `DATABASE_URL` at Supabase, so a plain `docker compose up` runs the whole stack
against live data. For everyday building and testing use the local-database override instead:

```
docker compose up -d postgres redis   # once: start the local database
npm run local:db:setup                # once: schema + demo company + demo story on that local database
npm run local:up                      # run the whole stack against the local database
npm run local:down                    # stop it
```

The demo login on the local database is `admin@accuqual.local` / `ChangeMe123!`. `ops/local-db.mjs` refuses
to run against anything but `localhost`, so the setup commands cannot touch Supabase by accident. Uploaded
files live in their own volume (`accuqual_uploads_local`) so they stay paired with that database.
Plain `docker compose up` (no override) still means "run against Supabase", so read the command before
pressing Enter. `npm test` has always used a separate throwaway `accuqual_test` database.

### 2. Nothing goes live from an unchecked commit

- **Deploys wait for the checks.** Every service in `render.yaml` uses `autoDeployTrigger: checksPass`, so
  Render deploys only after the GitHub checks (build, tests, security scan) pass on that commit. Work on a
  branch, open a PR, let CI run, then merge. Merging is what triggers a deploy. (This setting has not yet
  been exercised against a real Render account; confirm in the Render dashboard that each service shows
  "After CI checks pass" under Settings > Build & Deploy.)
- **Database changes go first, by hand.** Render never runs migrations. When a change adds a column or table:
  1. Run the **Migrate production database** workflow (GitHub > Actions > "Migrate production database",
     type `MIGRATE`). It applies the migrations with an approval step, using the `PRODUCTION_DATABASE_URL`
     secret in the `production` environment (set both up once: Settings > Environments).
  2. Only then merge the PR. Migrations here only ever add things, so the old code keeps working while the
     new schema is already in place.
- **Half-finished features stay off.** Build big features (billing, for example) on their own branch and merge
  when they're ready, or hide them behind a setting until they are.
- **Roll back** by redeploying the previous deploy from the Render dashboard (Events > Rollback). A migration
  is not rolled back that way, which is why migrations only add.

## Steps

### 1. Get your Supabase Session Pooler connection string

See "the one gotcha" above. Keep it somewhere safe — you'll paste it into
Render's dashboard, not into any file in this repo.

### 2. Run migrations against production

The production path is the **Migrate production database** GitHub Action,
described below. The same command run by hand, from a checkout, is:

```
cd services/api
DATABASE_URL="<your session pooler string>" npm run db:migrate
```

This is deliberately a manual/CI step, not something the deployed
container does at startup: `tsc` doesn't copy the raw `.sql` migration
files into `dist`, so migrations only ever run from a real source
checkout (via `tsx`), never from the built image. Re-run this same
command any time you add a new migration — it's fully idempotent.

If you want demo/reference data (roles, a demo company, test users) on
a fresh database, also run `DATABASE_URL="..." npm run db:seed` once.
For the real installation, skip the seed. Create the company and its first
administrator from the **accuqual-api Render Shell** after the service is
up — not from GitHub Actions, and not by committing a password. The exact
command is in [Private Render + Cloudflare Access](#private-render-cloudflare-access).

### 3. Deploy

In Render: New → Blueprint → connect this GitHub repo. It picks up
`render.yaml` at the repo root. That file defines two services, not the
workers. Plans, env vars, the disk, the domain, Cloudflare Access,
migrations, and the first administrator are in
[Private Render + Cloudflare Access](#private-render-cloudflare-access) below.

### 4. Verify

Run the smoke test in [Private Render + Cloudflare Access](#private-render-cloudflare-access) below (upload, reset email, `/api/health`).
What `/health` returns:

- `curl https://app.accuqualqms.com/api/health` → `{"status":"ok","database":{"status":"ok",...},"redis":{"status":"critical",...},...}`
  — a real readiness check, not a bare liveness ping (see "Monitoring &
  alerting" below). `status` is 503 only when the database itself is
  unreachable. `redis` is `critical` on this blueprint because Redis is
  not deployed; that does not cause a 503. See that section for why.
- Open https://app.accuqualqms.com (through Cloudflare Access), sign in
  with the administrator created from the Render Shell, and confirm a
  page that hits the API (for example the NCR list) loads without a CORS
  or network error in the browser console.

<a id="private-render-cloudflare-access"></a>

## Private Render + Cloudflare Access

Two Render web services, both Docker, both `autoDeployTrigger: checksPass`.
No Redis, no workers, no Stripe variables (billing was removed). This
installation is one company; do not add tenant plumbing.

### Services, plans, disk

| Service | Image | Plan | Notes |
|---|---|---|---|
| `accuqual-api` | `services/api/Dockerfile` | **starter** | `healthCheckPath: /health`. Persistent disk `uploads`, 1 GB, mounted at `/var/data`. A disk needs a paid instance and pins the service to one instance. |
| `accuqual-web` | `apps/web/Dockerfile` | **starter** | `free` is valid (no disk) but sleeps after inactivity, so the first visit and a password-reset link wait on a cold start. Starter stays on. |

**accuqual-api environment**

| Variable | Set to |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **Session Pooler** string (dashboard only) |
| `JWT_ACCESS_SECRET` | Render `generateValue: true` |
| `JWT_REFRESH_SECRET` | Render `generateValue: true` |
| `AI_CONFIG_ENCRYPTION_KEY` | `openssl rand -hex 32`. Paste once. **Never rotate** — stored company AI keys were encrypted with it |
| `ALLOWED_ORIGINS` | `https://app.accuqualqms.com` |
| `FRONTEND_URL` | `https://app.accuqualqms.com` |
| `STORAGE_LOCAL_PATH` | `/var/data/uploads` |
| `MONITOR_EXPECTED_WORKERS` | empty |
| `ALERT_WEBHOOK_URL` | optional |
| `SENTRY_DSN` | optional |
| `HEARTBEAT_URL` | optional |
| `ZEPTOMAIL_SEND_TOKEN` | optional; needed for the reset-email smoke test |
| `CONTACT_INBOX_EMAIL` | optional |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | optional fallback when ZeptoMail is unset |

Leave `API_PUBLIC_URL` unset. SSO callbacks then use `FRONTEND_URL` + `/api`, which is this proxy.

**accuqual-web environment**

| Variable | Set to |
|---|---|
| `VITE_API_BASE_URL` | `/api` (same origin, baked in at build; a change needs a redeploy) |
| `API_UPSTREAM_URL` | API origin, no path and no trailing slash, for example `https://accuqual-api.onrender.com`. Runtime only |
| `CF_ACCESS_CLIENT_ID` | optional; blank unless the API hostname is behind Access |
| `CF_ACCESS_CLIENT_SECRET` | optional; same. Blank sends no header |
| `VITE_SENTRY_DSN` | optional; build-time, so a change needs a redeploy |
| `NGINX_RESOLVER` | optional. Unset uses the container's own nameserver (`127.0.0.11` under Compose, Render's DNS on Render) |

`docker compose` keeps working: the web image defaults `API_UPSTREAM_URL` to `http://api:3000`, and compose sets that same value.

Workers, when you want them later, are in `render.workers.yaml`. That file is not a blueprint Render will sync.

### Custom domain (Cloudflare)

1. In Cloudflare DNS for `accuqualqms.com`, add a CNAME: `app` → the web service hostname Render shows (the `onrender.com` name, even though browsers will stop using it).
2. Leave the record **DNS only** (grey cloud) until Render's custom-domain check succeeds. An orange-cloud proxy hides Render from itself and the check fails.
3. After Render says the domain is verified, turn the record **Proxied** (orange cloud).
4. SSL/TLS → **Full (strict)**. Render presents a real certificate; Full (strict) checks it. Flexible will loop or strip HTTPS.

The blueprint sets `domains: [app.accuqualqms.com]` on `accuqual-web`.

### Cloudflare Access

Zero Trust → Access → Applications → Add an application → **Self-hosted**.

- Application domain: `app.accuqualqms.com`.
- Policy: Action **Allow**, Include **Emails**, one address (the person who administers this company).
- Everyone else gets the Access login wall, before nginx or the API sees the request.

If you also put the API hostname behind Access, create a **service token** and paste its Client ID and Client Secret into `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` on `accuqual-web`. nginx sends them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`, and only when they are non-empty.

### onrender.com subdomains

`renderSubdomainPolicy: disabled` is a real blueprint field ([Render blueprint spec](https://render.com/docs/blueprint-spec)). Render rejects `disabled` unless that service has at least one custom domain.

- **Web**: set in `render.yaml`, because `app.accuqualqms.com` is listed. Requests to the web service's `onrender.com` hostname return 404. Confirm in the dashboard after the first sync (Settings → custom domain / subdomain).
- **API**: not set. This blueprint gives the API no custom domain, so `disabled` would be invalid, and nginx still needs a hostname in `API_UPSTREAM_URL`. To turn the API's `onrender.com` hostname off later: add a custom domain, point `API_UPSTREAM_URL` at that `https://` origin (no path), put the hostname behind Access with the service token above, then set `renderSubdomainPolicy: disabled` on `accuqual-api`. Do that only after the upstream URL no longer uses `onrender.com`.

### Migrations

Render does not run migrations. The API image does not contain the `.sql` files.

1. **Back up first.** Take a `pg_dump` of the production database (both `public` and `drizzle`) and store it outside GitHub. The repository is public, so a dump must never be a workflow artifact. Procedure: [docs/operations/backup-and-restore.md](docs/operations/backup-and-restore.md).
2. **Confirm the database has exactly one tenant** before migrations `0073` and `0074`. `0074` aborts when `tenants` has more than one row, so two companies are not merged into one. `0073` still updates `erp_connector_presets.tenant_id`, which `0074` then drops.

   ```sql
   SELECT count(*) AS tenants FROM tenants;
   ```

   The result must be `1`. A brand-new empty database returns `0`; `0074` still applies in that case (it only refuses a count above 1) — do not seed demo data and do not insert a row by hand. If the query says `tenants` does not exist, `0074` has already run and the table is `company`.
3. GitHub → Actions → **Migrate production database** → Run workflow → type `MIGRATE`. The workflow uses the `production` environment and its `PRODUCTION_DATABASE_URL` secret (the Session Pooler string). One-time setup: Settings → Environments → `production`, with required reviewers if you want a second click, and that secret on the environment.

### First administrator

On **accuqual-api** (the web image is nginx and has no Node), open Render Shell. The image's `WORKDIR` is `/app`, and `dist/db/createCompany.js` is in the image:

```
node dist/db/createCompany.js --name "Company Name" --email admin@company.com
```

Optional: `--admin-name "Full Name"`. A temporary password is printed once to that shell and, when ZeptoMail or SMTP is set, emailed. Do **not** run this from GitHub Actions. The repository is public, so the password would be in a public log.

### Smoke test

1. **Upload survives a redeploy.** Sign in, upload a file on a record (a small PDF is enough), redeploy `accuqual-api`, and open the file again. It lives on the disk at `/var/data/uploads`. Anything written outside `/var/data` is gone after the deploy.
2. **Reset email arrives.** Use Forgot password for the administrator. The message arrives only after `ZEPTOMAIL_SEND_TOKEN` (or all of `SMTP_*`) is set; otherwise the send is logged and not delivered.
3. **`/api/health` is ok.** `curl -fsS https://app.accuqualqms.com/api/health` returns HTTP 200 with `"status":"ok"` and `"database":{"status":"ok",...}`. `"redis":{"status":"critical"}` is expected until Redis is deployed, and it does not fail the check.

## Monitoring & alerting

Monitoring has four layers. Each works on its own, none needs a paid plan to be
useful, and every one is off until you give it a URL or key — nothing breaks if
you skip it.

| Layer | What it tells you | Set up |
|---|---|---|
| **External uptime check** | The whole service is unreachable (process crashed, host down) | Point UptimeRobot / Better Stack / Freshping at `https://app.accuqualqms.com/api/health`, 5-minute interval, alert on non-2xx |
| **Heartbeat (dead-man's switch)** | The API process stopped running | Create a Healthchecks.io check (period 2 min, grace 3 min), put its ping URL in `HEARTBEAT_URL` |
| **Alert webhook** | Something inside is wrong right now | Put a Slack/Discord webhook in `ALERT_WEBHOOK_URL` (see below) |
| **Error tracking (Sentry)** | A bug happened, with the stack trace and the request that hit it | Two Sentry projects; DSNs into `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (web) |

### Follow one request end to end

Every API response carries an `X-Request-Id` header. The same id is on every log
line written while handling that request, on the error body (`requestId`), and on
the Sentry event. When a user sees "An unexpected error occurred (reference
3f9a1c2e)", search the logs for that reference — the first 8 characters are
enough to search — and you have everything that request did. A caller may supply its own
`X-Request-Id` (8–64 letters, digits, `-`, `_`, `.`) to tie the API's logs to its own.

### The built-in alerts

The API checks these once a minute and messages the webhook only when something
**starts** or **clears** (plus a reminder every 4 hours if it's still going):

| Alert | Fires when | What to do |
|---|---|---|
| **Database** | The database can't be reached | Check Supabase status and the connection string; nothing works without it |
| **API errors** | ≥ 5 server errors *and* ≥ 5% of requests in 5 minutes | Look in Sentry / the logs for the newest 5xx; usually one broken endpoint or a bad deploy — roll back |
| **Background workers** | A worker hasn't reported in for 90 s (or Redis is unreachable) | Restart that worker; check its logs. Workflows, AI jobs and IoT drift detection stop while it's down |
| **Workflow runs** | ≥ 3 workflow runs failed in 15 minutes | Admin Console → System Health, then Workflow Builder → Health for the failing definition |
| **Sign-in attacks** | ≥ 25 failed sign-ins in 10 minutes, or ≥ 3 accounts locked in 15 | Likely password guessing. Lockouts are already protecting accounts; consider blocking the source IP at the host |
| **Outgoing email** | ≥ 3 emails failed in 15 minutes | Check the ZeptoMail token / SMTP settings and provider status |

Admin Console → **System Health** shows the same six with what is firing right
now, which connections above are switched on, and the recent error rate.
`MONITOR_EXPECTED_WORKERS` lists the workers to watch. The private Render
blueprint sets it empty (no workers are deployed). `docker-compose.yml`
sets `workflow,ai,digital-twin` because that stack runs all three. Remove
a name if you don't run that worker.
A worker "reporting in" means its process is alive; it can't detect a worker that is up but stuck.

### Getting a webhook URL

- **Slack**: your workspace → Settings → search "Incoming Webhooks" → add one to a channel → copy the URL.
- **Discord**: channel Settings → Integrations → Webhooks → New Webhook → copy the URL and append `/slack`.

Paste either into `ALERT_WEBHOOK_URL` (already declared, `sync: false`, in `render.yaml`).

### Sentry

Create two projects (one Node.js, one React) and copy each DSN. Set `SENTRY_DSN`
on the API and `VITE_SENTRY_DSN` on the web service (a build-time value: redeploy
the web after setting it). What is sent: the error, its stack, the page path without the query string, the
user id (a number only), the request id, and the release (`APP_VERSION` —
the git commit on Render). What is never sent: request bodies, form values, cookies,
authorization headers, query strings, email addresses, IP addresses, session recordings.
Performance tracing is off. The API also exits (so the host restarts it) after an uncaught
exception rather than carrying on in an unknown state.

### /health, /health/live

`GET /health` is the readiness check Render's `healthCheckPath` uses: it pings the database
(and Redis, informationally) and reports `version` and `uptimeSeconds`; HTTP 503 only when the database is
unreachable. `GET /health/live` answers as long as the process is up and touches no dependency — for
a supervisor that should restart a *hung* process but never one that merely can't reach its database.

**Why `/health` still doesn't fail over a Redis outage**: the private blueprint
does not deploy Redis or the workers (`render.workers.yaml` holds those
definitions for later). `/health` would otherwise stay on 503 and Render
would restart a working API. `redis` in the JSON is informational. Promoting
it to a hard dependency in `checkReadiness()`
(`services/api/src/modules/monitoring/healthMonitor.ts`) is safe only after
Redis and all three workers are actually deployed.

## Security scanning

Four checks run automatically (`.github/workflows/security.yml`) on every pull request, every merge to main, and every
Monday morning (a new vulnerability is published without anyone pushing code, so the schedule is what notices it):

| Check | What it looks for | Blocks the build? |
|---|---|---|
| **Dependency audit** | Known vulnerabilities in the packages that ship (production dependencies of every workspace) | Yes, at high/critical. Dev-only tooling is listed in the run summary but doesn't block |
| **CodeQL** | Security bugs in our own code: injection, path traversal, unsafe crypto, ... Results are under the repo's **Security → Code scanning** tab | No — review the alerts |
| **Secret scan** (gitleaks) | Credentials committed anywhere in the full git history (`.gitleaks.toml` allowlists only the throwaway test-fixture passwords, by exact value, inside the test folder) | Yes |
| **Image scan** (Trivy; merges + weekly) | Vulnerabilities in the OS packages and libraries inside each of the five container images | Yes, for CRITICAL issues that have a fix; HIGH are listed |

GitHub's own secret scanning with push protection is also on, **Dependabot** opens a weekly pull request of dependency
updates (`.github/dependabot.yml`), security updates are switched on, and `SECURITY.md` tells outsiders how to report a
problem privately (Security tab → Report a vulnerability).

**When a scan fails:** a failing dependency or image scan almost always means "update the package / rebuild on the newer base
image" — merge Dependabot's PR or rebuild, and re-run. The production images contain only production dependencies, have
OS patches applied at build time, and no longer include npm or yarn.

**Known, accepted:** development-only advisories (the test runner, the dev server, the migration generator) — they never run in
production. Their fixes are major-version upgrades (vitest, vite, drizzle-kit) that Dependabot will propose.

## Data export & privacy documents

**Data export.** Admin Console → **Data Export** lets an organization's administrator download everything it holds
(records, history, uploaded files) as a ZIP, in JSON Lines or CSV. They re-enter their password (and authenticator
code) first; the browser then downloads from a single-use link that expires in two minutes; each export is audited
(who, when, row and file counts). Credentials are withheld and named in the manifest. Files are read only from the
organization's own folder under `STORAGE_LOCAL_PATH`, so what an export includes depends on that storage persisting
(a Docker volume, or a persistent disk on Render). Limits: 3 exports an hour per organization, one at a time, 250,000
rows per table, 1 GB of files (each file 100 MB).

**Privacy documents** live in `docs/privacy/`: `data-handling-summary.md` (for security questionnaires),
`subprocessors.md`, and `data-processing-addendum-template.md`. They contain **[bracketed]** items that need
values from your hosting accounts (regions, backup retention, deletion timeline) and the DPA template needs a
lawyer's review before it goes to a customer. Update `subprocessors.md` in the same change that adds or removes a
service that handles customer data.

## Backup & restore

The procedure, the checklist for a real recovery, and the results of the 2026-09-20 restore drill are in
[docs/operations/backup-and-restore.md](docs/operations/backup-and-restore.md). Short version: dump **both** the
`public` and `drizzle` schemas with `pg_dump --format=custom`, restore into an empty PostgreSQL 17 + pgvector,
run `npm run db:migrate` (recreates the application role, grants and security policies), then prove it with
`npm run db:verify-restore` (`SOURCE_DATABASE_URL` = original, `DATABASE_URL` = restored copy). Uploaded files and
the secrets in `.env` (notably `AI_CONFIG_ENCRYPTION_KEY`) are **not** in a database backup — keep separate
copies. Never store a dump as a GitHub artifact: the repository is public.

**Nightly off-platform backup.** `.github/workflows/backup.yml` takes an AES-256-encrypted backup every night to a private
S3-compatible bucket you own (14 daily / 8 weekly / 12 monthly) and, monthly, restores the newest one into a scratch database
and verifies it. It needs a bucket plus repository secrets (`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_S3_*`,
optional `BACKUP_HEARTBEAT_URL`); see "Automated nightly backup" in the runbook. Losing `BACKUP_PASSPHRASE` makes every backup unreadable.

## Real email delivery (ZeptoMail, or SMTP)

The preferred path is ZeptoMail's REST API, using the `qms_transactional`
agent (not the shut-down `mail_agent_1`) on the verified domain
`accuqualqms.com`. Set one env var, from ZeptoMail -> Agents ->
qms_transactional -> SMTP/API -> Send Mail token:

```
ZEPTOMAIL_SEND_TOKEN=<Send Mail token, with or without its "Zoho-enczapikey " prefix>
SMTP_FROM=AccuQual <noreply@accuqualqms.com>
```

`SMTP_FROM` must be an address on `@accuqualqms.com` or ZeptoMail rejects
the send (the failure is logged with ZeptoMail's own error message). The
token is env-only: paste it into the host's dashboard, never into this repo.
When it's set, it takes precedence over the SMTP section below; a 4xx from
ZeptoMail (bad token, unverified sender) is reported immediately, while
network errors, 429s and 5xx are retried up to 3 times.

### SMTP fallback

`notification.service.ts` degrades to an honest log-only stub (every
"email" is recorded but never actually sent) until all of
`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` are set — the same
opt-in pattern as the AI BYOK key and the alert webhook above. Verified
working end-to-end against a real Zoho Mail business account:

```
SMTP_HOST=smtppro.zoho.com
SMTP_PORT=465
SMTP_USER=<your business mailbox address>
SMTP_PASSWORD=<an app-specific password, if 2FA is on>
SMTP_FROM=AccuQual <your business mailbox address>
```

Any real SMTP-capable provider works the same way (SendGrid, Mailgun,
Amazon SES, another Zoho/Google Workspace/Microsoft 365 mailbox) — just
swap in that provider's host/port/credentials. All five are already
declared `sync: false` in `render.yaml`, so Render will prompt for them
on the next blueprint sync; paste the real values into Render's dashboard
directly, never into this repo. Note port 465 needs SSL — `SmtpTransport`
already sets that automatically whenever the port is 465, no code change
needed regardless of which port your provider gives you.

## What's still not set up (honest gaps, not this file's job to fix)

- No self-serve signup — this installation belongs to one company and its
  administrator creates every account.
