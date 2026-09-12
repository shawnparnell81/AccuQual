# AccuQual Database Specification

## 1. Database Technology Stack

- **PostgreSQL** (primary relational database)
- **Drizzle ORM** (schema + migrations)
- **pgvector** (AI embeddings)
- **Redis Streams** (event queue + workflow engine)
- **ElasticSearch** (search + analytics)
- **TimescaleDB** (optional time-series extension)

---

## 2. Database Architecture Overview

### Primary DB (PostgreSQL)
Holds all structured QMS data:
- Users, roles, permissions
- NCR, CAPA, 8D
- Audits, audit items
- Documents, versions
- Training records
- Change management
- Risk/FMEA
- Supplier quality
- Calibration
- Complaints
- Workflow definitions + runs
- AI suggestions + risk scores

### Secondary DBs
- **Redis Streams** → workflow engine queue
- **ElasticSearch** → full-text search + analytics
- **pgvector** → embeddings for AI engine
- **TimescaleDB** → IoT + digital twin time-series data

---

## 3. Drizzle Schema (Representative)

### ROLES
```ts
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
});
```

### USERS
```ts
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  roleId: integer("role_id").references(() => roles.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### NCR
```ts
export const ncr = pgTable("ncr", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  severity: text("severity"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});
```

### CAPA
```ts
export const capa = pgTable("capa", {
  id: serial("id").primaryKey(),
  ncrId: integer("ncr_id").references(() => ncr.id),
  rootCause: text("root_cause"),
  actionPlan: text("action_plan"),
  verification: text("verification"),
  status: text("status").default("open"),
  ownerId: integer("owner_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### 8D
```ts
export const eightD = pgTable("eight_d", {
  id: serial("id").primaryKey(),
  ncrId: integer("ncr_id").references(() => ncr.id),
  currentStep: integer("current_step").default(1),
  data: jsonb("data"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### AUDITS
```ts
export const audits = pgTable("audits", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  auditorId: integer("auditor_id").references(() => users.id),
  status: text("status").default("scheduled"),
  scheduledAt: timestamp("scheduled_at"),
  completedAt: timestamp("completed_at"),
});
```

### AUDIT ITEMS
```ts
export const auditItems = pgTable("audit_items", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").references(() => audits.id),
  question: text("question"),
  finding: text("finding"),
  severity: text("severity"),
  evidence: text("evidence"),
});
```

### WORKFLOW DEFINITIONS
```ts
export const workflowDefinitions = pgTable("workflow_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: text("module"),
  definition: jsonb("definition"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### WORKFLOW RUNS
```ts
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflowDefinitions.id),
  context: jsonb("context"),
  status: text("status").default("running"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});
```

### AI SUGGESTIONS
```ts
export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  module: text("module"),
  input: jsonb("input"),
  output: jsonb("output"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### AI RISK SCORES
```ts
export const aiRiskScores = pgTable("ai_risk_scores", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  score: numeric("score"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## 4. Drizzle Migration Example

```ts
import { sql } from "drizzle-orm";

export const up = async (db) => {
  await db.execute(sql`
    CREATE TABLE roles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );
  `);

  await db.execute(sql`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      role_id INTEGER REFERENCES roles(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.execute(sql`
    CREATE TABLE ncr (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      severity TEXT,
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP
    );
  `);
};
```

---

## 5. Database TODOs for Claude

### Schema TODOs
- TODO: Generate full schema for all modules
- TODO: Add foreign key constraints everywhere
- TODO: Add indexes for high-volume tables
- TODO: Add soft-delete flags where needed
- TODO: Add audit trail tables

### Migration TODOs
- TODO: Generate initial migration set
- TODO: Generate incremental migrations per module
- TODO: Generate seed data for development

### AI / Analytics TODOs
- TODO: Create pgvector embedding tables
- TODO: Create TimescaleDB hypertables for IoT data
- TODO: Create ElasticSearch index mappings

### Performance TODOs
- TODO: Add partitioning for large tables (NCR, CAPA, audits)
- TODO: Add caching layer for frequently accessed data
- TODO: Add materialized views for dashboards

