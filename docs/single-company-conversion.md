# Single-company conversion

Decision (2026-09-25): this product serves exactly one company. Multi-company behavior was removed, not hidden. Billing was removed. The public landing page and its contact form stayed. Hosting stayed Render and Supabase.

The change landed in migration `0074_single_company`. Older migration files still mention `tenant_id` and `tenants`. Current schema and application code use the `company` row. `DEPLOY.md` still tells you to count `tenants` before that migration on a database that has not run it yet.

## What changed

- `tenant_id` (and the unique indexes and foreign keys built on it) came off every table. `tenants` became a one-row `company` table that keeps the settings JSON: branding, AI config, plant, feasibility, inventory, ERP, receiving, supplier, profile, and onboarding. Billing tables and the platform-admin role were dropped.
- The per-request tenant transaction became a plain per-request transaction. `req.tenantId`, the tenant claim in login tokens, the tenant code at sign-in, the platform-admin module, the tenant routes, and the billing module were removed. Single sign-on is one connection for the company.
- The web app lost the platform console, tenant-code fields, company pickers, and the Billing page. Copy that said "tenant" says "company" or is gone.
- Cross-company isolation tests were removed with the feature. Other tests stayed.
- `0074` aborts when `tenants` has more than one row, so two companies are not merged. Confirm the count before that migration on a database that still has `tenants`. An empty database (count 0) still applies. See `DEPLOY.md`.

## Still true

- The landing page and contact form stay. There is no billing.
- A second company is not supported. Moving the customer to their own cloud account is their own cutover.
- Existing data was kept. The migration drops columns and policies. It does not reset the database.
- Raw SQL was the place a dropped column could hide after the TypeScript compile went clean, because the compiler does not see string queries.
