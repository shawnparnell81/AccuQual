# AccuQual

A multi-tenant, next-generation Quality Management System SaaS: ISO/IATF/FDA compliance modules, AI-driven quality intelligence, digital twin simulation, browser-native fillable PDF forms, and a multi-window desktop-style workspace — built as a TypeScript monorepo.

## Stack

- **Backend** (`services/api`): Node.js, Express, Drizzle ORM, PostgreSQL (with Row-Level Security), Zod, JWT, Winston, Redis Streams, pdf-lib
- **Frontend** (`apps/web`): React, Vite, TailwindCSS, React Query, Zustand, React Router, Axios, Recharts, PDF.js, react-rnd
- **Workers** (`workers/*`): workflow engine, AI embedding, and digital-twin drift-detection background processes
- **DevOps** (`infra/*`, `.github/workflows/*`): Docker, Kubernetes (AKS), Terraform (Azure), GitHub Actions CI/CD

## Getting started

```bash
npm install
cp .env.example .env               # fill in DATABASE_URL, JWT secrets, LLM API keys
cp apps/web/.env.example apps/web/.env

docker compose up -d postgres redis

npm run db:migrate --workspace services/api   # also enables RLS + policies, see below
npm run db:seed --workspace services/api

npm run dev:api      # http://localhost:3000
npm run dev:web      # http://localhost:5183 (not Vite's default 5173 — see apps/web/vite.config.ts)
```

The seed creates:
- A **platform admin** (`platform-admin@accuqual.local` / `ChangeMe123!`) — manages tenants, has no `tenantId` of its own.
- A **demo tenant** (code `demo`) with its own tenant admin (`admin@accuqual.local` / `ChangeMe123!`) and default form templates.
- New users self-register with `POST /auth/register` + a `tenantCode` (e.g. `"demo"`) to join an existing tenant — tenants themselves are provisioned by a platform admin at `/platform` (UI) or `POST /platform/tenants` (API), per the Tenant Onboarding Flow Spec.

Run everything (API, web, all three workers) containerized: `docker compose up --build`.

## Multi-tenancy — how isolation actually works

Two independent, deliberately redundant layers:

1. **Application-level (primary, always active):** every one of the 34 tables carries a `tenantId`. `src/lib/tenantScope.ts`'s `withTenantDb` middleware resolves `tenantId` from the JWT and opens **one Postgres transaction per request**, running `SET LOCAL app.current_tenant_id` on it — a real, per-request-scoped setting, never leaked across requests because the transaction (and its underlying pooled connection) is committed/rolled back and released at the end of that same request. Every module's controller/service also explicitly filters by `req.tenantId` in its own queries — this is what actually gates every read/write, independent of RLS.
2. **Database-level (defense in depth):** `src/drizzle/post-migrate/rls-policies.sql` enables Row-Level Security and a `tenant_isolation` policy on every tenant-owned table, checked against the `app.current_tenant_id` session var layer (1) sets. **Caveat, stated plainly:** Postgres exempts the table owner from RLS unless `FORCE ROW LEVEL SECURITY` is used, and this migration deliberately doesn't force it (see the SQL file's comment) — so RLS is present but not actually exercised when the app connects as the owning role, which is what the default local `DATABASE_URL` does. It becomes real, active enforcement once the app connects as a non-owner role (see the SQL file for the `CREATE ROLE` snippet) — required before production.

Deliberate, documented exceptions that bypass the per-request `req.db` convention (searchable via `grep -rn "db/index.js" services/api/src/modules` — re-audited for this pass; **8** import sites, not 3, falling into three real categories, none of them dead code):
- **No tenant resolved yet** — `modules/auth` (login/register run before a tenant is known), `modules/platform` (tenant provisioning is inherently cross-tenant, platform-admin only, gated by `requirePlatformAdmin`), `modules/roles` (roles like admin/quality_manager are platform-wide constants, not tenant data).
- **Liveness pings that touch zero tenant data** — `modules/monitoring/healthMonitor.ts` and `modules/system-health/systemHealth.controller.ts` both only ever run a bare `SELECT 1` to prove the database is reachable; there is no tenant-scoped query here to bypass.
- **Work with no HTTP request to scope from** — `modules/reporting/reporting.scheduler.ts` is an in-process interval poller (no cron/queue infra exists in this app — see its own header comment) that has to look across every tenant's due `report_schedules` rows by design; once it picks a row, every subsequent read/write in that run is explicitly filtered by that row's own `tenantId`, never a client-supplied one. `modules/crar/crar.controller.ts` and `modules/rma-log/rmaLog.controller.ts` import `pool` (not `db`) for exactly one reason each: calling `recordAuditTrailStandalone` (`audit-trail.service.ts`) to log an entry that must survive even if the request's own transaction is later rolled back — that helper still applies the same RLS role-switch and `app.current_tenant_id` session var `withTenantDb` does, on its own short-lived connection, so it is not an unscoped write.

A prior audit pass claimed the CRAR/RMA Log `pool` imports were dead code — re-verified false: both are actively called (`recordAuditTrailStandalone(pool, ...)` at the point a permission-denied write attempt is logged), so nothing was removed here.

A real vulnerability class was found and fixed during this pass: `crudFactory`'s generic `update` handler spread `req.body` straight into `.set()`, and one route (`PATCH /8d/:id`) had no Zod validation in front of it — meaning a client could have sent `{ tenantId: <other> }` and reassigned a row to a different tenant. Fixed at both layers: `crudFactory` now strips `id`/`tenantId`/`createdAt`/`createdBy` from any client body before writing (`utils/crudFactory.ts`, covered by `test/crud-factory.test.ts`), and the missing validation schema was added.

## What was built (this pass — multi-tenant + forms/PDF + multi-window)

- **Multi-tenancy foundation**: `tenants` table, `tenantId` added to all 30 pre-existing tables plus the 3 new form tables, JWT carries `tenantId`, every module updated to use the per-request tenant-scoped `req.db` instead of the old shared singleton, `iot_devices` uniqueness fixed from global to per-tenant.
- **Tenant onboarding** (`modules/platform`): `POST /platform/tenants` creates a tenant + its first admin user + default form templates + local storage directories in one call (steps 1–5, 7–8 of the Onboarding Flow Spec real; step 9's onboarding email is logged, not sent — no email service is wired up); `DELETE /platform/tenants/:id` soft-deletes (deactivates the tenant and all its users). A minimal `/platform` admin UI lists/creates/deactivates tenants.
- **Forms & PDF Engine** (`modules/forms`): `form_templates`/`form_data`/`form_versions` tables, a real service layer (`loadTemplate`/`loadData`/`saveData`/`createVersion`/`exportPdf`), and `pdf-merger.ts` using `pdf-lib` — it fills a real AcroForm template's fields when one exists on disk, and falls back to rendering a plain one-page PDF of the data when it doesn't (which is always, today — AccuQual ships no real template binaries, only the field-map contract). Two AI pipelines added (`/ai/forms/suggest`, `/ai/forms/autofill`).
- **Multi-window workspace** (`apps/web/src/window-manager`): `useWindowStore` (tenant-scoped, persisted to `localStorage` per tenant, cleared on logout, windows deduped by type+entity), `WindowFrame` (drag/resize via `react-rnd`, minimize/maximize/close, z-index stacking), `WindowContainer`/`WindowManager`. Only **form** windows have real content (`FormEditor` + `PdfViewer` via PDF.js + `FormVersionHistory`) — document/audit/ai/digitalTwin windows render a placeholder, since the existing route pages read state from `useParams` and would need refactoring to accept props to be reusable inside a window (tracked below). "Open Form" is wired into NCR, CAPA, and 8D detail pages (see the later QMS forms pass below for the rest).
- **Hardening pass**: audited every module for tenant-scoping gaps (see above), fixed the one found, added a request logger that includes `tenantId` in every structured log line.

Everything from the original single-tenant pass (all 18 backend modules, AI engine, digital twin, DevOps) is still in place, extended rather than rebuilt, per the patch pack's own instructions.

Verified end-to-end in this pass: `services/api` and `apps/web` both type-check, build, and lint cleanly; all 3 workers type-check and build; `services/api`'s unit tests (workflow engine, simulation engine, and the new `crudFactory` field-stripping regression test) pass; a new Drizzle migration was generated against the full updated schema (34 tables).

## What was built (this pass — real QMS form library + full nav wiring)

- **14 real form templates**, derived 1:1 from the user's own `.xls`-converted PDFs and registered as `layouts/*.ts` in the existing schema-driven forms engine (`apps/web/src/components/forms/layouts/`, mirrored in `services/api/src/modules/forms/layouts/`): FMEA, an upgraded 8-section Automotive NCR, Appearance Approval Report, APQP Summary, Control Plan, Dimensional Report, LPA, Process Flow Diagram, PCN, Master Production Log, and Daily Production & Quality Log — each consolidated onto one continuous page/table instead of the source's multi-page column-wrapping.
- **Computed form fields**: extended the layout type system with `"number"`, `"select"`, and `"computed"` field kinds (`apps/web/src/components/forms/formulas.ts`) — FMEA's R.P.N. (Severity x Occurrence x Detection, initial and revised) and the Master Production Log's Yield % are calculated automatically and re-saved into the row on every edit, never typed in.
- **Calibration due-date coloring**: `CalibrationPage`'s equipment roster now shows a computed, color-coded status pill (green "Current" / amber "Due Within 60 Days" / orange "Due Within 30 Days" / red "Past Due" / gray "Never Calibrated") from a new `listWithStatus` controller that joins each equipment row to its latest calibration record.
- **Dashboard KPI**: a live "Corrective Action Effectiveness" chart + stat card built from real CAPA status counts, replacing the source spreadsheet's static chart template with one that updates the same way every other dashboard stat does.
- **New PPAP module** (`/ppap`, table `ppap_packages`): one package per part, its detail page opening APQP Summary / Control Plan / Dimensional Report / Process Flow Diagram / Appearance Approval as five forms scoped to the same package.
- **New Production Logs page** (`/production-logs`): the two roster-style logs are company-wide documents, not per-record forms, so each opens as a fixed singleton (no list to click into).
- **Full nav + detail-page wiring**: every form type now has a real "Open Form" entry point — Risk/FMEA and Change/PCN each got a detail page (`RiskDetailPage`, `ChangeDetailPage`); Audits' detail page gained Audit Plan / Audit Checklist / Layered Process Audit buttons; `OpenFormButton` gained an optional `label` prop so a detail page with several form types (like PPAP's five) doesn't show five identically-labeled buttons.
- **Not attempted**: the Process Flow Diagram's hand-drawn shape/connector diagram (only its tabular step data is digitized — see the layout file's own comment); a Customer Scorecard dashboard widget (AccuQual has no per-customer PPM/OTD/warranty-cost data model at all, so it would mean inventing numbers).

Verified: `tsc` clean on both `apps/web` and `services/api`, `eslint` clean on every changed/new file, the existing `vitest` suite (9 tests) still passes, and a new Drizzle migration (`0002_add_ppap_packages`) was generated for `ppap_packages` (35 tables total). Not run against a live Postgres in this pass, consistent with every migration before it.

## What was built (this pass — 10 more form templates + closed out supplier/training/complaint/calibration)

- **10 more real form templates** from a second user-supplied folder (some printed from the user's own "Integrated Management Workspace" tool rather than raw `.xls`-to-PDF): Approved Vendor List, Competency Matrix + Document Control Index (two formTypes split out of one source PDF's Part A/Part B), Context of the Organization, DVPR, Management Review, Maintenance Work Order, Production Output Log, plus an **upgrade** of `audit_plan` from its old 3-field placeholder to the real Internal Audit Plan document.
- **More computed fields** in `formulas.ts`: `maintenanceTotalCost`, `competencyQualificationPercent`, `avlPerformanceScore` (tier thresholds confirmed with the user directly — Approved needs PPM≤25 AND Delivery≥98%, Conditional is PPM≤100 OR Delivery≥95%), `netYield`.
- **Gage R&R and Pareto Chart are bespoke React components**, not `layouts/*.ts` schemas — their calculations are whole-table (a 10-part x 2-operator x 2-trial grid's per-column means/ranges; sort-by-quantity + cumulative %), which the row-by-row computed-column model can't express. New `apps/web/src/components/forms/customForms/` registry, wired into `FormEditor.tsx` as a rendering option alongside layouts and the legacy field-list fallback. Each still gets a plain **export-only** `FormLayout` on the server so PDF export has real values to print — deliberately not mirrored to the client (see both `layouts/index.ts` files' comments). Gage R&R's AIAG formulas were checked value-for-value against the source PDF's own worked example.
- **Closed out `supplier`, `training`, `complaint`, and `calibration`** (the per-event form) — new `SupplierDetailPage`, `TrainingDetailPage` (required adding a missing `GET /training/:id` route), `ComplaintDetailPage`, and `EquipmentDetailPage` (required adding missing `GET /equipment/:id` and `GET /equipment/:id/calibration` routes), each with a real "Open Form" button. `discrepancy_inspection` remains the one formType with no module/page to attach it to.
- **New nav items**: "Management System" (Context of the Organization + Management Review, both fixed singletons) and "Pareto Analysis". Production Logs, Training, and Documents pages each gained an extra card/document; PPAP gained DVPR as a 6th document.

Verified the same way as the pass above: `tsc -b`/`npm run build` clean on both packages, `eslint` clean, `vitest` (9 tests) passes. No new tables this pass — only 2 new route handlers plus the usual formType registration.

## Remaining TODOs

- **RLS enforcement**: create and switch to a non-owner Postgres role in any real deployment (see the caveat above) — right now it's schema-present but not yet exercised locally.
- **Window content**: document/audit/ai/digitalTwin window types are placeholders; the existing pages need a props-driven refactor (not just `useParams`) to be reusable inside a window.
- **Tenant provisioning depth**: no default workflow_definitions are seeded for a new tenant; onboarding email is logged, not sent (no email service wired up); tenant branding (logo/color) isn't applied to the UI yet (format — hex vs. HSL triplet — isn't settled).
- **PDF templates**: no tenant ever has a real uploaded AcroForm PDF, so every export falls through to the fallback renderer — a real schema-driven single-page PDF for any form type with a `layouts/*.ts` entry (most of them, as of this pass), a crude key:value dump otherwise. There's still no upload flow for a tenant's own custom template.
- **Forms without an "Open Form" entry point**: `discrepancy_inspection` is the last one — no DI module/page exists at all to attach it to. Every other formType in the system now has a real entry point (see the two QMS forms passes above).
- **Form version rollback (Full-System Audit finding L5)**: `POST /forms/:type/:id/version` snapshots and `GET .../history` lists past versions, but there's no restore path — `FormVersionHistory.tsx`'s sidebar is view-only. See `forms.service.ts`'s `listVersions` for the sketch of what a real rollback would need to do (re-snapshot current state first, then overwrite `form_data` with the chosen version). Not planned/implemented.
- **Management Review and Context of the Organization are fixed singletons**, not a dated history of past reviews — a deliberate simplification (see `ManagementSystemPage.tsx`'s comment); a real "past reviews" list would need an actual list/detail module.
- **Workers**: still share code with `services/api` via relative imports rather than a shared package (see `workers/README.md`); the AI/workflow workers' own DB connections don't go through the same per-request RLS transaction as the API (they write with an explicit `tenantId` only — layer 1, not layer 2).
- **Everything already listed in the original pass** (see git history / this file's prior revision): no MFA/password-reset, Azure Blob not wired for `STORAGE_DRIVER=azure`, Workflow Builder isn't a real drag-and-drop canvas, no integration tests against a real Postgres/Redis, Terraform unvalidated against a real Azure subscription. (ElasticSearch, formerly listed here as "mapped but unused," was removed entirely — see the M6 fix: the container, its config, and the unused dependency are gone, not just idle.)
- **No CSRF protection on `POST /auth/refresh`** (security-audit finding): it's authenticated purely by an ambient httpOnly cookie with `SameSite=None` in production (required by the real cross-origin Render topology), so a cross-site page can trigger it via the victim's browser. Actual exploit impact is limited (cookie rotation is transparent to the same browser; no secret is exposed to the attacker's origin since httpOnly + CORS block response reading), but it's a real defense-in-depth gap. No mechanical fix applied — closing it properly needs a CSRF-token architecture (a double-submit cookie or a custom-header check), not a patch to the existing flow.
- **Refresh tokens have no rotation or reuse detection** (security-audit finding): a stolen refresh token remains valid for its full TTL, and there's no automatic detection of an already-superseded token being replayed — only manual revocation via logout/password-reset (`tokenVersion` bump). A correct fix needs per-token (`jti`) tracking and a used/revoked table — a schema addition, not implemented here.
- **4 modules still have no dedicated integration test file** (security-audit finding, lowest priority — RBAC/tenant-scoping is correct today, just unguarded by regression tests): `rma-activity-log` (a thin, mostly-automated event trail), `quality-inspection-reports`, the core `inventory` module beyond its existing lot-tracing tests, and the core `suppliers` module beyond its existing supplier-portal tests.

## Roadmap

1. Stand up a real Postgres + Redis, run migrate/seed, and manually verify tenant isolation: create two tenants, confirm tenant A's JWT can never read/write tenant B's NCRs/forms/windows.
2. Switch the app's `DATABASE_URL` role to a non-owner role so RLS becomes real enforcement, not just present.
3. Build the tenant PDF template upload flow (multipart upload → `form_templates.pdfPath` under `/tenants/<id>/forms/<type>/`) so exports stop falling back to the plain renderer.
4. Refactor DocumentsPage/AuditDetailPage/AiInsightsPage/DigitalTwinPage to accept props instead of `useParams`, then give document/audit/ai/digitalTwin windows real content.
5. Seed default workflow_definitions per tenant on creation; wire a real email service for onboarding.
6. Everything from the original roadmap: real workflow definitions, AI pipelines against a real LLM key, Azure Blob, integration tests, a real Terraform apply. (ElasticSearch dropped from this list — see M6: removed as dead infrastructure, not deferred.)
