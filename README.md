# AccuQual

Quality management for one company. Modules follow ISO 9001 / IATF 16949 practice. AccuQual is not certified, registered, or endorsed by ISO, IATF, or any other standards body. TypeScript monorepo. Schema and migrations live under `services/api/src/drizzle/`. The sidebar is `apps/web/src/components/layout/navConfig.ts`.

## Stack

- Backend (`services/api`): Node.js, Express, Drizzle, PostgreSQL on Supabase (including local dev), Zod, JWT, Winston, Redis Streams, pdf-lib.
- Frontend (`apps/web`): React, Vite, Tailwind, React Query, Zustand, React Router, Axios, Recharts, PDF.js, react-rnd.
- Workers (`workers/*`): workflow engine, AI embeddings, and digital-twin drift detection. They import `services/api` by relative path. See `workers/README.md`.
- Deploy: Docker images on Render, defined in `render.yaml`. See `DEPLOY.md`. Nightly encrypted backups go to Cloudflare R2 (`docs/operations/backup-and-restore.md`).

## Getting started

```bash
npm install
docker compose up -d          # postgres, redis, api, web, and all 3 workers
```

- Web: http://localhost:5183
- API: http://localhost:3000 (`/health`)

Read `docs/development/local-setup-and-testing.md` before running a script by hand. There are three `.env` files. Containers (root `.env`) talk to Supabase. A script run inside `services/api` reads a different `.env` that points at local Postgres, with no warning if those are swapped.

Seeded account (`services/api/src/db/seed.ts`). Change it before any real use.

- Demo company admin: `admin@accuqual.local` / `ChangeMe123!`
- `npm run db:seed-demo-story --workspace services/api` loads a supplier defect walked from receiving through a computed risk score. `db:reset-demo-story` removes only those rows.

A real installation creates its company and first administrator with:

```bash
npm run db:create-company --workspace services/api -- --name "Company" --email admin@company.com
```

There is no self-registration. The administrator creates every other user.

## Where the modules are

- API: `services/api/src/docs/openapi.ts` registers every route. Each folder under `services/api/src/modules/` is one feature.
- Nav: `apps/web/src/components/layout/navConfig.ts` is the department list, every registered module, and the default access level.
- Which modules use the Workflow Builder and which use their own state machine: `accuqual-workflow-architecture.md`.
- Product notes: `docs/product/AccuQual-Product-Overview.md` and `docs/product/AccuQual-UI-UX.md`.

Form signatures use a 4-digit PIN. The first sign-in after an account is created asks for that PIN once. It can be changed later under Settings → Security. Signing a form asks for the PIN and a certification checkbox. On success the field shows the person's display name with the date and time in the company timezone. The audit trail records who signed, which field, when, and the certification text. The PIN is stored as a hash. It is not shown again, and an administrator cannot read it.

## One company

The application serves a single company. There is no per-company filter. The company is one row in `company`, which also holds branding, AI settings, plants, and module rules.

Each request runs in one Postgres transaction (`src/lib/requestDb.ts`, `withDb`) and switches to the restricted role `accuqual_app`. That role can read and write ordinary tables. On the audit tables (`src/drizzle/post-migrate/audit-triggers.sql`) it can only append to `audit_trail` and can only read `audit_row_changes`, so application code cannot rewrite history. Every table has row-level security with one policy for that role (`src/drizzle/post-migrate/rls-policies.sql`), which keeps Supabase's public roles out.

Exceptions to the per-request `req.db` convention (`grep -rn "db/index.js" services/api/src/modules`):

- `modules/auth` — no signed-in user yet, and the credential tables are deny-all for `accuqual_app`
- `modules/roles` — the app role may read roles, not write them
- monitoring liveness pings
- the reporting scheduler, an in-process poller with no HTTP request
- controllers that call `recordAuditTrailStandalone` so the row survives if the request transaction rolls back

Deleting an account clears refresh tokens, trusted devices, recovery codes, and password-reset tokens as the table owner inside that same transaction, then switches back to `accuqual_app`.

## Known limits

- Only Quality has edit rights on training and calibration by default. Other departments get read unless an admin grants edit.
- Quarantined or held stock is not netted out of low-stock alerts.
- Training has no prerequisite enforcement (course A before course B).
- SSO (OIDC) is built and unit-tested. It has not been run against a real identity provider.
- "Similar past NCRs" needs an embeddings key that is not configured.
- Worker Runtime (a shop-floor worker module) is designed and not built. `worker_profiles` only stores title, shift, hire date, notes, and tags on top of `users`.

## More

- `docs/development/local-setup-and-testing.md` — `.env` files, tests, ports, the drizzle-kit workaround.
- `docs/development/adding-a-module.md` — checklist used since PR #76.
- `docs/development/new-modules-design-notes.md` — versioning, quarantine holds, calibration due-status, training qualification, calculated pass/fail.
- `docs/operations/credential-rotation.md` — database password, R2 key, backup passphrase.
- `docs/operations/backup-and-restore.md` — nightly backup and restore.
- `DEPLOY.md` — Render and Supabase, and the four monitoring layers (uptime check, heartbeat, alert webhook, Sentry).
- `SECURITY.md` — reporting a vulnerability.

The pass-by-pass build log that used to live here is in git history. The database role switch is enforced, CSRF is fixed (PR #78), and refresh tokens rotate with reuse detection.
