# Deploying AccuQual

Everything in this file has been proven against the real infrastructure it
describes — a real Supabase project, and the real Docker images this repo
already builds — not written from theory. One piece (Render's automatic
cross-service URL wiring in `render.yaml`) is a well-reasoned best effort
that hasn't been run against a real Render account yet; it's called out
explicitly below so it's not mistaken for something already verified.

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
`render.yaml` at the repo root automatically. It defines two services:

- **accuqual-api** — the Node/Express API (`services/api/Dockerfile`)
- **accuqual-web** — the React frontend, served by nginx (`apps/web/Dockerfile`)

You'll be prompted for the env vars marked `sync: false`:
- `accuqual-api`'s `DATABASE_URL` → your Session Pooler string from step 1
- `accuqual-api`'s `TENANT_AI_CONFIG_ENCRYPTION_KEY` → generate with
  `openssl rand -hex 32`; this must be a real value, or the app refuses to
  start (see the boot guard note above)

`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are set to `generateValue: true`
— Render generates real random secrets for you, nothing to do here.

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
  unreachable; `redis` is reported for visibility but never causes a 503,
  since this blueprint doesn't provision a managed Redis service at all
  (see that section for why).
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

**Why Redis/the workflow-worker aren't part of this**: this blueprint
deploys only `accuqual-api` and `accuqual-web` — no managed Redis service
and no worker processes are defined in `render.yaml` today, so the
Workflow Engine's event-driven side isn't live on this exact deployment as
described. Making `/health` fail over a Redis outage would therefore have
made Render treat an otherwise-fully-functional deployment as permanently
unhealthy. If Redis + the workers are deployed later (their own Render
blueprint entries, or a managed Redis add-on), `checkReadiness()` already
computes a real `redis` status — promoting it to a hard dependency at that
point is a one-line change in `healthMonitor.ts`, not a rebuild.

## What's still not set up (honest gaps, not this file's job to fix)

- No self-serve signup — accounts are still provisioned via the internal
  platform-admin flow.
- No billing/tier enforcement — see the Inspection Report's TIER-01
  finding.
- The workflow-worker/ai-worker/digital-twin-worker processes and a managed
  Redis service have no `render.yaml` entries — the Workflow Engine's
  event-driven automation isn't live on this exact deployment until that's
  added.
