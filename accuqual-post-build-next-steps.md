You have completed the major multi-tenant build-out of AccuQual, including tenant-aware forms, window manager, PDF engine, AI pipelines, digital twin, and DevOps scaffolding. Now move into the final multi-tenant hardening and isolation phase.

Your tasks:

1. **Verify and enforce tenant isolation across all backend modules**
   - Ensure every table includes tenant_id.
   - Ensure RLS is enabled on all tenant-scoped tables.
   - Ensure all queries filter by tenant_id.
   - Ensure tenant_id is injected into PostgreSQL via `SET LOCAL app.current_tenant_id`.
   - Ensure no cross-tenant reads or writes are possible.

2. **Harden the multi-tenant PDF engine**
   - Ensure templates load from tenant-specific directories.
   - Ensure form data is stored per tenant.
   - Ensure versioning is tenant-scoped.
   - Ensure PDF export uses tenant-specific branding and templates.
   - Add caching for tenant-specific templates.

3. **Harden the multi-window workspace**
   - Ensure windows are tenant-scoped.
   - Ensure workspace persistence is tenant-scoped.
   - Ensure window IDs cannot collide across tenants.
   - Ensure cross-tenant window leakage is impossible.
   - Add tenant-aware cleanup when switching tenants.

4. **Harden the frontend tenant context**
   - Ensure tenant_id is included in all API calls.
   - Ensure tenant context is stored in a secure session.
   - Ensure window manager restores only windows for the active tenant.
   - Ensure form editor loads only tenant-specific templates and data.

5. **Harden the AI engine**
   - Ensure embeddings are tenant-scoped.
   - Ensure AI suggestions only use tenant data.
   - Ensure prompt templates are tenant-specific.
   - Ensure no cross-tenant leakage in AI pipelines.

6. **Harden the digital twin**
   - Ensure IoT ingestion is tenant-scoped.
   - Ensure simulations are tenant-scoped.
   - Ensure digital twin windows are tenant-scoped.
   - Ensure no cross-tenant access to models or simulations.

7. **Harden DevOps**
   - Add tenant-aware environment variables.
   - Add tenant-aware secrets.
   - Add tenant-aware autoscaling rules.
   - Add tenant-aware monitoring dashboards.
   - Add tenant-aware log filtering.

8. **Perform a full multi-tenant penetration test pass**
   - Attempt cross-tenant reads.
   - Attempt cross-tenant writes.
   - Attempt cross-tenant window access.
   - Attempt cross-tenant PDF template access.
   - Attempt cross-tenant AI suggestion access.
   - Attempt cross-tenant digital twin access.
   - Ensure all attempts fail.

9. **Deliver final outputs**
   - A summary of all multi-tenant hardening completed.
   - A list of remaining TODOs.
   - A recommended roadmap for the next development phase.
   - A final project export.

Important:
- Do NOT regenerate the project from scratch.
- Continue refining and extending the existing project.
- Maintain strict TypeScript usage and modular architecture.
- Ensure the final project is production-ready, stable, and fully multi-tenant.

Begin now.
