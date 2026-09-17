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

Two real, complementary pieces exist now — neither requires a paid
third-party service to get real value, and both degrade gracefully with
zero setup:

1. **`GET /health` is a real readiness check**, not a bare "the process is
   up" ping — it pings the actual database (and Redis, informationally)
   on every request. This is what Render's own `healthCheckPath` already
   hits (see `render.yaml`), so Render will restart an instance whose
   database has genuinely gone unreachable, not just one that crashed.
   Point any external uptime checker at this same URL for a second,
   independent layer of coverage that survives even if the whole process
   (not just the database) goes down — Render's own restart-on-failure
   only catches that case, an *external* checker also tells you about it.
   A free tier of any of these works: UptimeRobot, Better Stack, or
   Freshping — point it at `https://<your-api-url>/health` on a 5-minute
   interval and set it to alert on a non-2xx response.

2. **A built-in alert poller** (`services/api/src/modules/monitoring/healthMonitor.ts`)
   runs inside the API process itself, re-checking readiness once a minute
   and logging loudly the moment the database goes unreachable — this
   happens automatically, with zero configuration, and is visible in
   Render's own log stream today. To also get a real push notification
   (Slack, Discord, or anywhere else that accepts a Slack-style `{text}`
   JSON webhook), set the `ALERT_WEBHOOK_URL` env var:
   - **Slack**: your workspace → Settings → search "Incoming Webhooks" →
     add one to a channel → copy the Webhook URL it gives you.
   - **Discord**: a channel's Settings → Integrations → Webhooks → New
     Webhook → copy its URL and append `/slack` to the end (Discord's
     webhooks accept Slack's payload shape at that suffix).
   Paste either URL into `ALERT_WEBHOOK_URL` in Render's dashboard (it's
   already declared, `sync: false`, in `render.yaml` — leave it blank to
   skip this entirely). No redeploy needed for a plain env var change on
   Render, just a restart.

**Why `/health` still doesn't fail over a Redis outage, even now that a
real managed Redis is part of this blueprint**: not every account deploying
this blueprint necessarily re-synced to pick up the 4 new services (see
step 3) — an account still running only the original `accuqual-api`/
`accuqual-web` pair would have `/health` permanently reporting `redis` as
unreachable (nothing is listening at `REDIS_URL`'s default), which would
make Render treat an otherwise-fully-functional deployment as permanently
unhealthy. Once you've confirmed the Redis service and all three workers
are actually deployed and healthy, promoting `redis` to a hard dependency
in `checkReadiness()` (`services/api/src/modules/monitoring/healthMonitor.ts`)
is a genuine, safe one-line change at that point — just not done
automatically here, since it's a real behavior change to `/health`'s HTTP
status, not just additive config.

## Real email delivery (SMTP)

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
