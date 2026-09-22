# Adding a new module

The checklist actually followed to add Equipment & Calibration, Quarantine,
and Training & Competency (all merged in PR #77) and Document Versioning
(PR #76). A "module" here means a new tenant-owned table (or set of
tables) with its own routes, RBAC, and — usually — a nav entry. Skip
whichever steps don't apply (a module with no nav entry, no audit-worthy
writes, etc.).

Read `docs/development/local-setup-and-testing.md` first if you haven't —
step 1 below needs the drizzle-kit workaround and the right `.env`.

## 1. Schema

New file, `services/api/src/drizzle/schema/<module>.ts`. Every tenant-owned
table needs a `tenantId: integer("tenant_id").references(() => tenants.id).notNull()`
column — that's what layer 1 of tenant isolation (`withTenantDb`) and layer 2
(RLS) both key off. Export it from `drizzle/schema/index.ts`.

Generate the migration:

```bash
cp -r services/api/node_modules/drizzle-orm node_modules/drizzle-orm
npm run db:generate --workspace services/api
rm -rf node_modules/drizzle-orm
```

Review the generated SQL before moving on — a renamed column can come out
as a drop + add instead of a rename, which loses data on a real database.

## 2. Post-migrate SQL

Three files under `services/api/src/drizzle/post-migrate/`, each with its
own list to extend:

- **`rls-policies.sql`** — add the new table name to the `tenant_tables`
  array. This is what turns on Row-Level Security for it.
- **`indexes.sql`** — add whatever indexes the module's own query patterns
  need (at minimum, an index on `tenant_id`, usually composite with the
  columns you'll filter or sort by).
- **`version-freeze.sql`** — only if something about the table needs to be
  append-only or frozen once decided (quarantine resolutions, decided
  competency evaluations, published document versions all use this
  pattern). Triggers here are written as plain SQL functions — when
  scripting an edit to this file, never use a find/replace that treats
  `$$` (the SQL dollar-quote) as an ordinary character; it's easy to
  corrupt the trigger body that way.

## 3. Service layer

`services/api/src/modules/<module>/<module>.service.ts` — the actual
business logic, independent of Express. Anything computed rather than
stored (a due date, a qualification status, whether a hold blocks a
movement) belongs here as a pure function you can unit-test without a
database.

## 4. Controller, validation, routes

- `<module>.validation.ts` — Zod schemas for every request body.
- `<module>.controller.ts` — thin; each handler calls the service and
  shapes the response. Every handler that mutates data should call
  `recordAuditTrail` (or fit into the module's own `recordAuditTrailStandalone`
  case — see the README's tenant-isolation section for when that's used
  instead of the default per-request `req.db`).
- `<module>.routes.ts` — mount each route behind
  `requirePermission("<subject>.<action>")` (see step 6). Register the
  router in `services/api/src/routes/index.ts`. **Order matters**: if the
  module needs its own specific gate rather than inheriting a router-level
  blanket department gate, register it *before* any `.use()` that would
  apply that blanket gate to its paths too — this exact regression (a
  router-level gate wrongly catching unrelated routes) has happened before
  with ERP presets.

## 5. Permissions

- **`middleware/requirePermission.ts`** — add the subject (e.g.
  `quarantine: { resource: "quarantine", entityType: "Quarantine" }`) and
  list its actions (`view`, `edit`, `manage`, or a module-specific verb
  like `calibrate`/`release`/`evaluate`).
- **`db/defaultPermissions.ts`** — seed which departments get `view` vs
  `edit` by default for a brand-new tenant.
- **`db/backfillDepartmentPermissions.ts`** — this is what has to be
  *run* (not just edited) against every **existing** tenant after deploy,
  or nobody in an existing company can use the new module until an admin
  manually grants it. `npm run db:backfill-permissions --workspace services/api`
  is idempotent — safe to re-run.

## 6. Nav and menu registration (if the module needs a top-level entry)

- **`middleware/departmentAccess.ts`** — add the `ResourceKey` and its
  label in `MODULE_LABELS`.
- **`apps/web/src/components/layout/navConfig.ts`** — add the `NavLeaf`
  and put it in the right department's `items` array (or the `department:
  null` System group). The dynamic nav registry means this is only the
  *default* visibility — a tenant admin granting another department
  access via Roles & Permissions makes the item appear for them too,
  without touching this file again.

## 7. Audit trail and workflow registries

- **`modules/audit-trail/audit-trail.routes.ts`** — add the entity type to
  `ENTITY_TYPE_TO_RESOURCE` so the audit trail viewer can resolve
  permission on it (reuse an existing resource key, like `"erp"`, if the
  new entity is adjacent to one that already exists — don't invent a
  redundant one).
- **`modules/workflow/workflow.controller.ts`** — add to
  `MODULE_ENTITY_TYPES` only if the module participates in the generic
  Workflow Engine (most don't — see `accuqual-workflow-architecture.md`
  for which modules use their own hand-coded state machine instead).

## 8. OpenAPI

`services/api/src/docs/openapi.ts` — register each path with
`registry.registerPath`. This is the API reference; there's no separate
hand-maintained one, so a route that isn't registered here effectively
doesn't exist in the docs even though it works.

## 9. Web client and pages

- `apps/web/src/api/<module>.ts` — typed client functions +
  `useQuery`/`useMutation` hooks, same shape as every other module's API
  file.
- Page(s) under `apps/web/src/routes/<Module>/` — list + detail, or
  whatever the module actually needs. Reuse `ResourceListPage` for a
  plain list instead of hand-rolling a table.
- Wire the route into `App.tsx`.

## 10. Tests

`services/api/test/integration/<module>-lifecycle.test.ts` — a real-DB
integration test (see `tenant-isolation.test.ts`'s header comment for the
pattern) covering: the actual lifecycle end to end, RBAC (each department's
view vs edit, and that customers/suppliers are always refused), tenant
isolation, and the audit trail. Run the full suite three times, not once
— see `local-setup-and-testing.md` on why.

## 11. Deploy

Once merged: `npm run db:migrate` (root, against Supabase — see the `.env`
gotcha in `local-setup-and-testing.md`), then
`npm run db:backfill-permissions --workspace services/api`, then rebuild
and restart the `api` and `web` containers. A schema-only change needs no
web rebuild; a route or UI change needs both.
