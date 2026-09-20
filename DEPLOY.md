# Deploying AccuQual

Everything in this file has been proven against the real infrastructure it
describes — a real Supabase project, and the real Docker images this repo
already builds — not written from theory. Two pieces are a well-reasoned
best effort that hasn't been run against a real Render account yet, called
out explicitly where they appear below: Render's automatic cross-service
URL wiring, and the `accuqual-redis`/worker service blocks (the `type:
redis` service shape and its `connectionString` property name specifically
— the workers' own Docker images are real and already build successfully
in CI, only the render.yaml wiring around them is unverified).

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

Session pooler, not Transaction pooler — this app's real Row-Level
Security enforcement depends on `SET LOCAL ROLE` + `SET LOCAL
app.current_tenant_id` persisting for one transaction (see
`src/lib/tenantScope.ts`), which Session pooler supports and Transaction
pooler is not guaranteed to. Both verified to work end-to-end already;
only Session pooler is recommended.

## What's already proven, live, against the real Supabase project

- Full schema + real RLS role (`accuqual_app`) + pgvector + all indexes
  deploy cleanly via the existing `npm run db:migrate` — no changes needed.
- Real RLS enforcement (correct tenant sees its row; wrong/missing tenant
  context sees zero rows) works identically over the network as it does
  locally.
- The full automated test suite (28 tests: tenant isolation + department
  permissions) passes against the real remote database.
- The actual production Docker image (`services/api/Dockerfile`) boots
  correctly against Supabase via the Session Pooler, a real login
  round-trips correctly, and the RLS role-switch works through the pooler.
- The production boot guard correctly refuses to start with a default
  encryption key when `NODE_ENV=production` (tested deliberately) — and
  correctly stays quiet when given a real one.
- Supabase's own security linter (Advisor) went from 4 CRITICAL findings
  to "no issues found" after `db:migrate`'s Supabase-lockdown step ran
  (revokes the anon/authenticated access Supabase grants by default —
  see `services/api/src/drizzle/post-migrate/supabase-lockdown.sql`).

## Steps

### 1. Get your Supabase Session Pooler connection string

See "the one gotcha" above. Keep it somewhere safe — you'll paste it into
Render's dashboard, not into any file in this repo.

### 2. Run migrations against production, from your own machine (once)

```
cd services/api
DATABASE_URL="<your session pooler string>" npm run db:migrate
```

This is deliberately a manual/CI step, not something the deployed
container does at startup: `tsc` doesn't copy the raw `.sql` migration
files into `dist`, so migrations only ever run from a real source
checkout (via `tsx`), never from the built image. Re-run this same
command any time you add a new migration — it's fully idempotent.

If you want real demo/reference data (roles, a demo tenant, test users) on
a fresh database, also run `DATABASE_URL="..." npm run db:seed` once.
Skip this for a real customer's database.

### 3. Deploy via the render.yaml blueprint (or manually — see below)

In Render: New → Blueprint → connect this GitHub repo → it should pick up
`render.yaml` at the repo root automatically. It defines six services:

- **accuqual-api** — the Node/Express API (`services/api/Dockerfile`)
- **accuqual-web** — the React frontend, served by nginx (`apps/web/Dockerfile`)
- **accuqual-redis** — a managed Redis instance (the Workflow Engine's real
  event bus). **This one is paid/metered**, unlike the two services above —
  Render shows you the real plan/pricing before provisioning it.
- **accuqual-workflow-worker** / **accuqual-ai-worker** / **accuqual-digital-twin-worker**
  — the three background processes that consume that Redis stream (see
  `/workers`). Each needs the exact same `DATABASE_URL` and
  `TENANT_AI_CONFIG_ENCRYPTION_KEY` values as `accuqual-api` — Render has
  no way to share one service's `sync: false` value with another, so
  you'll paste each of those two values in four times total, identically.
  Already deployed to only the original two services? Render Dashboard →
  your Blueprint → **Manual Sync** picks up these 4 new services without
  needing to recreate anything.

You'll be prompted for the env vars marked `sync: false`. On `accuqual-api`:
- `DATABASE_URL` → your Session Pooler string from step 1
- `TENANT_AI_CONFIG_ENCRYPTION_KEY` → generate with `openssl rand -hex 32`;
  this must be a real value, or the app refuses to start (see the boot
  guard note above)
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` and
  `ALERT_WEBHOOK_URL` are optional — see their own sections below.

On each of the three workers: the same `DATABASE_URL` and
`TENANT_AI_CONFIG_ENCRYPTION_KEY` values as `accuqual-api` (not fresh
ones — the encryption key in particular MUST match, since
`accuqual-workflow-worker` decrypts tenant BYOK keys that were encrypted
under `accuqual-api`'s key). `accuqual-workflow-worker` also optionally
takes the same `SMTP_*`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` values as
`accuqual-api`, and `accuqual-ai-worker` optionally takes `OPENAI_API_KEY`
(its embedding generation always calls OpenAI specifically, regardless of
a tenant's own provider choice).

`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are set to `generateValue: true`
on every service — Render generates real random secrets for you, nothing
to do here. The workers never actually verify a token with these; they're
only required because every process here imports the same env-validation
module `accuqual-api` does.

**The one part of render.yaml that's a best effort, not yet verified
against a real Render account:** `ALLOWED_ORIGINS`, `FRONTEND_URL`, and
`VITE_API_BASE_URL` are wired via Render's `fromService` cross-references,
which *should* resolve to each service's real public URL automatically
once both exist. If `accuqual-web` can't reach the API after deploying
(check the browser console for a CORS error or failed requests), the
fallback is manual:
1. Find `accuqual-api`'s real URL in the Render dashboard (something like
   `https://accuqual-api.onrender.com`).
2. Set `accuqual-web`'s `VITE_API_BASE_URL` env var to that exact URL,
   and trigger a manual redeploy of `accuqual-web` (Vite bakes this in at
   build time, so a redeploy — not just a restart — is required).
3. Set `accuqual-api`'s `ALLOWED_ORIGINS` to `accuqual-web`'s real URL the
   same way, and redeploy `accuqual-api`.

### 4. Verify

- `curl https://<your-api-url>/health` → `{"status":"ok","database":{"status":"ok",...},"redis":{"status":"ok"|"critical",...},...}`
  — a real readiness check now, not a bare liveness ping (see "Monitoring &
  alerting" below). `status` is 503 only when the database itself is
  unreachable; `redis` is reported for visibility but never causes a 503
  even now that a real managed Redis is part of this blueprint — see that
  section for why this stayed informational-only rather than being
  promoted to a hard dependency.
- Check each worker's own Render log stream shows its real "listening on
  accuqual:..." startup line (see each `workers/*/src/index.ts`) instead of
  a crash-and-restart loop — the most common cause of the latter is a
  missing/mismatched `TENANT_AI_CONFIG_ENCRYPTION_KEY` on that worker.
- Open the deployed frontend URL, log in with a real seeded user, confirm
  a page that hits the API (e.g., the NCR list) loads without a CORS or
  network error in the browser console.

## Monitoring & alerting

Monitoring has four layers. Each works on its own, none needs a paid plan to be
useful, and every one is off until you give it a URL or key — nothing breaks if
you skip it.

| Layer | What it tells you | Set up |
|---|---|---|
| **External uptime check** | The whole service is unreachable (process crashed, host down) | Point UptimeRobot / Better Stack / Freshping at `https://<api-url>/health`, 5-minute interval, alert on non-2xx |
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
`MONITOR_EXPECTED_WORKERS` (default empty; set in `render.yaml` and
`docker-compose.yml`) lists the workers to watch — remove a name if you don't run that worker.
A worker "reporting in" means its process is alive; it can't detect a worker that is up but stuck.

### Getting a webhook URL

- **Slack**: your workspace → Settings → search "Incoming Webhooks" → add one to a channel → copy the URL.
- **Discord**: channel Settings → Integrations → Webhooks → New Webhook → copy the URL and append `/slack`.

Paste either into `ALERT_WEBHOOK_URL` (already declared, `sync: false`, in `render.yaml`).

### Sentry

Create two projects (one Node.js, one React) and copy each DSN. Set `SENTRY_DSN`
on the API and `VITE_SENTRY_DSN` on the web service (a build-time value: redeploy
the web after setting it). What is sent: the error, its stack, the page path without the query string, the
tenant id and user id (numbers only), the request id, and the release (`APP_VERSION` —
the git commit on Render). What is never sent: request bodies, form values, cookies,
authorization headers, query strings, email addresses, IP addresses, session recordings.
Performance tracing is off. The API also exits (so the host restarts it) after an uncaught
exception rather than carrying on in an unknown state.

### /health, /health/live

`GET /health` is the readiness check Render's `healthCheckPath` uses: it pings the database
(and Redis, informationally) and reports `version` and `uptimeSeconds`; HTTP 503 only when the database is
unreachable. `GET /health/live` answers as long as the process is up and touches no dependency — for
a supervisor that should restart a *hung* process but never one that merely can't reach its database.

**Why `/health` still doesn't fail over a Redis outage**: not every account deploying this blueprint
necessarily re-synced to pick up the worker services. An account still running only the original
`accuqual-api`/`accuqual-web` pair would have `/health` permanently reporting `redis` as unreachable,
which would make Render treat an otherwise-functional deployment as unhealthy. Once you've confirmed Redis
and all three workers are deployed and healthy, promoting `redis` to a hard dependency in
`checkReadiness()` (`services/api/src/modules/monitoring/healthMonitor.ts`) is a safe one-line change —
just not done automatically, since it changes `/health`'s HTTP status.

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

- No self-serve signup — accounts are still provisioned via the internal
  platform-admin flow.
- No billing/tier enforcement — see the Inspection Report's TIER-01
  finding.
