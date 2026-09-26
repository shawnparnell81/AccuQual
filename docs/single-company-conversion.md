# Converting AccuQual to a single-company product

Decision (2026-09-25): this codebase becomes a product for exactly one company. All multi-company ("tenant") functionality is removed, not hidden. The billing section is removed too; the public landing page and its contact form stay. Hosting is unchanged (Render + Supabase).

Work happens on `refactor/single-company`. Nothing is merged or deployed until every phase below is done and the whole suite passes.

## Safety net

- Baseline before the change: 1020 backend tests pass.
- The TypeScript compiler is the main guide: once the schema loses its company-id columns, every stale reference becomes a compile error, so nothing is left behind silently. Raw SQL strings are the exception and are searched for separately.
- Existing data survives: the database change is a new migration that drops columns and policies, it does not reset the database.

## Phases

1. **Database.** Remove `tenant_id` (and the composite unique indexes and foreign keys built on it) from every table. Turn the `tenants` table into a one-row `company` table that keeps the settings JSON (branding, AI config, plant/feasibility/inventory/ERP/receiving/supplier settings, profile, onboarding). Drop the billing tables and the platform-admin concept. Remove row-level security, the per-request database role switch, and the tenant parts of the audit and version-freeze triggers. One hand-checked migration.
2. **API core.** Replace the per-request "tenant transaction" with a plain per-request transaction (same commit-before-response behaviour, no role switch). Remove `req.tenantId`, the tenant claim in login tokens, the tenant code at sign-in, the platform-admin module and role, the tenant routes and the billing module. Single sign-on becomes one connection for the company.
3. **API modules.** About 2,500 references in 196 files: drop every `tenantId` filter and column value, and every `tenantId` function parameter. Workers, seeds and scripts included.
4. **Web app.** Remove the platform console, tenant-code fields, company pickers and the Billing page. Anything that showed "tenant" becomes "company" or disappears.
5. **Tests.** About 80 test files build a tenant first. Rewrite the fixtures, delete the cross-company isolation and RLS coverage tests (they test a feature that no longer exists), keep everything else.
6. **Cleanup.** Docs, comments, names, `render.yaml`, compose files and the demo seed. Final search: the word "tenant" should remain only inside old migration files.
7. **Deploy.** Rehearse the migration on a copy of the database, then run it on Supabase and rebuild the containers.

## Decided

- Keep the landing page and contact form. Remove billing.
- No second company will ever exist. If the customer later moves to their own cloud account, that move is theirs to do.
