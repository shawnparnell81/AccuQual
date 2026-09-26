# AccuQual

A Quality Management System for one company: quality modules structured
around ISO 9001 / IATF 16949 practices (AccuQual itself is **not**
certified, registered or endorsed by ISO, IATF, or any other standards
body). TypeScript monorepo, 108 tables across 65 migrations, 43
nav-registered modules across 7 departments.

## Stack

- **Backend** (`services/api`): Node.js, Express, Drizzle ORM, PostgreSQL
  (hosted on **Supabase**, including in local
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

Seeded account (`services/api/src/db/seed.ts` — **change this before
any real use**):
- Demo company admin: `admin@accuqual.local` / `ChangeMe123!`.
- `npm run db:seed-demo-story --workspace services/api` — a coherent
  demo dataset (a supplier defect walked from receiving through a
  computed risk score). `db:reset-demo-story` removes only those rows.

This installation belongs to exactly one company. A real installation
creates its company and first administrator with
`npm run db:create-company --workspace services/api -- --name "Company" --email admin@company.com`.
There is no self-registration: the administrator creates every other user.

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

## One company — how data access works

The application serves a single company; there is no per-company
scoping anywhere. The company itself is one row in the `company` table,
which also holds the company-wide settings (branding, AI, plants and
module rules).

Requests run in **one Postgres transaction each**
(`src/lib/requestDb.ts`'s `withDb`), which switches into a restricted
database role, `accuqual_app`. That role can read and write ordinary
tables but is limited on the audit tables
(`src/drizzle/post-migrate/audit-triggers.sql`): it can only append to
`audit_trail` and can only read `audit_row_changes`, so a bug in
application code cannot rewrite history. Every table also has
row-level security switched on with one policy for that role
(`src/drizzle/post-migrate/rls-policies.sql`), which keeps Supabase's
public roles out.

Deliberate exceptions to the per-request `req.db` convention (see
`grep -rn "db/index.js" services/api/src/modules`): `modules/auth`
(no signed-in user yet), `modules/roles` (constants), monitoring's
liveness pings, the reporting scheduler (an in-process poller with no
HTTP request), and controllers that call `recordAuditTrailStandalone` to
log an entry that must survive even if the request's own transaction
rolls back.

## Known limits (told to every testing round — keep this list honest)

- Only Quality has edit rights on training and calibration by default;
  other departments get read unless an admin grants edit.
- Quarantined/held stock is not netted out of low-stock alerts.
- Training has no prerequisite enforcement (course A before course B).
- SSO (OIDC) is built and unit-tested but never run against a real
  identity provider.
- "Similar past NCRs" needs an embeddings key that isn't configured.
- Worker Runtime (a shop-floor worker module) is designed but not built.

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
original build, an earlier version, the two QMS
form-library passes, and the RLS/CSRF/refresh-token gaps identified back
then) has been superseded by everything built since — the database role switch is enforced,
CSRF is fixed (PR #78), refresh tokens rotate with reuse detection, and
dozens of modules were added. That history is preserved in git log rather
than repeated here; `git log --oneline` and each PR's description are the
accurate record of what shipped when.
