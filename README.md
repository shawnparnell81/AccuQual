# AccuQual

A multi-tenant Quality Management System: quality modules structured
around ISO 9001 / IATF 16949 practices (AccuQual itself is **not**
certified, registered or endorsed by ISO, IATF, or any other standards
body). TypeScript monorepo, 108 tables across 65 migrations, 43
nav-registered modules across 7 departments.

## Stack

- **Backend** (`services/api`): Node.js, Express, Drizzle ORM, PostgreSQL
  with Row-Level Security (hosted on **Supabase**, including in local
  dev — see below), Zod, JWT, Winston, Redis Streams, pdf-lib.
- **Frontend** (`apps/web`): React, Vite, TailwindCSS, React Query,
  Zustand, React Router, Axios, Recharts, PDF.js, react-rnd.
- **Workers** (`workers/*`): workflow engine, AI embedding, and
  digital-twin drift-detection background processes — share code with
  `services/api` via relative imports (see `workers/README.md`), not a
  published shared package.
- **Deploy**: Docker containers, deployed to **Render** via
  `render.yaml` (see `DEPLOY.md`) — not Kubernetes/Azure/Terraform,
  despite what an older revision of this file said. Nightly encrypted
  backups to Cloudflare R2 (`docs/operations/backup-and-restore.md`).

## Getting started

```bash
npm install
docker compose up -d          # postgres, redis, api, web, and all 3 workers
```

- Web: http://localhost:5183
- API: http://localhost:3000 (`/health`)
- **Read `docs/development/local-setup-and-testing.md` before running
  anything by hand** — there are three separate `.env` files, and the
  containers (root `.env`) talk to Supabase even in local dev; a script
  run from inside `services/api` reads a *different* `.env` pointing at
  a local Postgres, with no warning if you get it backwards.

Seeded accounts (`services/api/src/db/seed.ts` — **change these before
any real use**):
- Platform admin: `platform-admin@accuqual.local` / `ChangeMe123!` —
  manages tenants, has no `tenantId` of its own.
- Demo tenant (code `demo`) admin: `admin@accuqual.local` /
  `ChangeMe123!`.
- `npm run db:seed-demo-story --workspace services/api` — a coherent
  demo dataset (a supplier defect walked from receiving through a
  computed risk score) for the demo tenant. `db:reset-demo-story`
  removes only those rows.

New users self-register with `POST /auth/register` + a `tenantCode`.
Tenants themselves are provisioned by a platform admin at `/platform`.

## What's here

Rather than list every module in prose (it drifts out of date — see the
history below), the modules themselves are the source of truth:

- **API surface**: `services/api/src/docs/openapi.ts` registers every
  route; every folder under `services/api/src/modules/` is one feature
  area.
- **Nav / what a person actually sees**:
  `apps/web/src/components/layout/navConfig.ts` — the department
  structure and every registered module, with its default per-department
  access level.
- **Which modules use the generic Workflow Engine vs. their own
  hand-coded state machine**: `accuqual-workflow-architecture.md`.

## Multi-tenancy — how isolation actually works

Two independent, deliberately redundant layers:

1. **Application-level (primary, always active):** every tenant-owned
   table carries a `tenantId`. `src/lib/tenantScope.ts`'s `withTenantDb`
   middleware resolves `tenantId` from the JWT and opens **one Postgres
   transaction per request**, running `SET LOCAL app.current_tenant_id`
   on it. Every module's controller/service also explicitly filters by
   `req.tenantId` — this is what actually gates every read/write,
   independent of RLS.
2. **Database-level (defense in depth):**
   `src/drizzle/post-migrate/rls-policies.sql` enables Row-Level Security
   and a `tenant_isolation` policy on every tenant-owned table (a new
   table's name is added to that file's `tenant_tables` array when it's
   created — see `docs/development/adding-a-module.md`).

Deliberate exceptions to the per-request `req.db` convention (see
`grep -rn "db/index.js" services/api/src/modules`): `modules/auth` and
`modules/platform` (no tenant resolved yet, or inherently cross-tenant),
`modules/roles` (platform-wide constants), monitoring's liveness pings
(no tenant-scoped query exists to bypass), the reporting scheduler (an
in-process poller with no HTTP request to scope from — every query inside
it is still filtered by the row's own `tenantId`), and controllers that
call `recordAuditTrailStandalone` to log an entry that must survive even
if the request's own transaction rolls back.

## Known limits (told to every testing round — keep this list honest)

- Only Quality has edit rights on training and calibration by default;
  other departments get read unless an admin grants edit.
- Quarantined/held stock is not netted out of low-stock alerts.
- Training has no prerequisite enforcement (course A before course B).
- SSO (OIDC) is built and unit-tested but never run against a real
  identity provider.
- "Similar past NCRs" needs an embeddings key that isn't configured.
- Worker Runtime (a shop-floor worker module) is designed but not built.
- Self-service sign-up is blocked on an undecided billing-tier design.

## Where to look next

- `docs/development/local-setup-and-testing.md` — the `.env` gotcha,
  running tests, ports, the drizzle-kit workaround.
- `docs/development/adding-a-module.md` — the checklist actually
  followed for every module added since PR #76.
- `docs/development/new-modules-design-notes.md` — why the versioning
  engine, quarantine's hold enforcement, calibration's due-status, and
  training's qualification logic are built the way they are.
- `docs/operations/credential-rotation.md` — rotate a database password,
  an R2 key, or the backup passphrase without breaking anything.
- `docs/operations/backup-and-restore.md` / `docs/operations/testing-readiness.md`
  — the nightly backup runbook, and what's deployed/testable right now.
- `DEPLOY.md` — deploying to Render against Supabase, and the four
  monitoring layers (uptime check, heartbeat, alert webhook, Sentry) and
  how to wire each one.
- `SECURITY.md` — reporting a vulnerability.

## Earlier build history

The detailed pass-by-pass build log that used to live in this file (the
original single-tenant build, the multi-tenant conversion, the two QMS
form-library passes, and the RLS/CSRF/refresh-token gaps identified back
then) has been superseded by everything built since — RLS is enforced,
CSRF is fixed (PR #78), refresh tokens rotate with reuse detection, and
dozens of modules were added. That history is preserved in git log rather
than repeated here; `git log --oneline` and each PR's description are the
accurate record of what shipped when.
