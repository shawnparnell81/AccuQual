# AccuQual – Multi-Tenant Patch Pack

Apply these changes across the existing AccuQual specifications and project to fully support multi-tenant SaaS behavior.

---

## A. Multi-Tenant Architecture Patch

### Add to `accuqual-architecture.md`:

- All core subsystems (API, Forms, AI, Digital Twin, Workflow, PDF Engine, Window Manager) must be **tenant-aware**.
- Introduce a **Tenant Context Layer**:
  - Reads `tenant_id` from JWT claims.
  - Propagates `tenant_id` through backend services.
  - Exposes `tenant_id` to frontend via session/context.
- All services must accept `tenant_id` as a required parameter.
- All data access must be scoped by `tenant_id` and enforced via RLS.

---

## B. Multi-Tenant Database Schema Extensions

### Add to `accuqual-database.md`:

#### 1. Tenant Table

```ts
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

#### 2. Add `tenant_id` to all major tables

For example:

```ts
export const ncr = pgTable("ncr", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  // existing fields...
});
```

Apply `tenantId` to:
- `users`
- `ncr`
- `capa`
- `eightD`
- `audits`
- `auditItems`
- `complaints`
- `suppliers`
- `equipment`
- `change`
- `risk`
- `workflowDefinitions`
- `workflowRuns`
- `aiSuggestions`
- `aiRiskScores`
- `digitalTwinModels`
- `digitalTwinSimulations`
- `formData`
- `formVersions`

#### 3. RLS (Row-Level Security) Policy (conceptual)

For each table:

- Enable RLS.
- Add policy:

```sql
CREATE POLICY tenant_isolation ON ncr
USING (tenant_id = current_setting('app.current_tenant_id')::int);
```

Backend must set:

```sql
SELECT set_config('app.current_tenant_id', <tenant_id>, false);
```

per request.

---

## C. Multi-Tenant PDF Engine Patch

### Add to `accuqual-forms.md` and backend spec:

#### 1. Tenant-Scoped Template Registry

- Store templates as:

```ts
export const formTemplates = pgTable("form_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  formType: text("form_type").notNull(),
  pdfPath: text("pdf_path").notNull(),
  fieldMap: jsonb("field_map").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

#### 2. Template Resolution

`formService.loadTemplate(tenantId, formType)`:
- Look up `formTemplates` by `tenantId + formType`.
- Load PDF from `/tenants/<tenant_id>/forms/<form_type>/template.pdf`.

#### 3. Tenant-Scoped Form Data

Ensure `formData` and `formVersions` include `tenantId` and all queries filter by it.

---

## D. Multi-Tenant Window Manager Patch

### Add to `accuqual-frontend.md`:

#### 1. Window Store Shape

```ts
type WindowInstance = {
  id: string;
  tenantId: string;
  type: "form" | "document" | "audit" | "ai" | "digitalTwin";
  entityId?: number;
  formType?: string;
  title: string;
  state: any;
};
```

#### 2. Zustand Store

- `useWindowStore` must:
  - Store `tenantId` per window.
  - Filter windows by current `tenantId`.
  - Clear windows when tenant changes.

#### 3. Workspace Persistence

- Persist windows per tenant:

```ts
localStorage.setItem(`accuqual_workspace_${tenantId}`, JSON.stringify(windows));
```

- Restore only windows for the active tenant.

---

## E. Multi-Tenant AI Patch

### Add to `accuqual-ai.md`:

#### 1. Tenant-Scoped Embeddings

Embedding tables must include `tenantId`:

```ts
export const aiEmbeddings = pgTable("ai_embeddings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

#### 2. AI Pipelines

All AI pipelines must:
- Accept `tenantId`.
- Query only data where `tenant_id = tenantId`.
- Use tenant-specific prompt templates (branding, terminology).

#### 3. No Cross-Tenant Leakage

- Never aggregate data across tenants.
- Never train global models on raw tenant data without anonymization.
- All AI suggestions must be based only on the requesting tenant’s data.

---

## F. Multi-Tenant Digital Twin Patch

### Add to `accuqual-digital-twin.md`:

#### 1. Tenant-Scoped Models

`digitalTwinModels` and `digitalTwinSimulations` must include `tenantId` and be filtered by it.

#### 2. IoT Ingestion

IoT data must include `tenantId`:

```ts
export const iotData = pgTable("iot_data", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  deviceId: text("device_id"),
  timestamp: timestamp("timestamp").notNull(),
  data: jsonb("data"),
});
```

#### 3. Digital Twin Windows

Digital twin windows in the window manager must include `tenantId` and only show models/simulations for that tenant.

---

## G. DevOps Multi-Tenant Notes (Optional but Recommended)

- Environment variables must include tenant-aware configs (e.g., branding, limits).
- Monitoring dashboards must support per-tenant views (filters by `tenant_id`).
- Logging must include `tenant_id` in structured logs.

---

## Execution Instructions for Claude

After ingesting this Multi-Tenant Patch Pack:

- Do NOT regenerate the project from scratch.
- Extend the existing project to:
  - Add `tenantId` fields.
  - Add RLS policies.
  - Add tenant-aware services and stores.
  - Update all queries and APIs to require `tenantId`.
- Ensure all modules (forms, windows, AI, digital twin) are fully tenant-scoped.

