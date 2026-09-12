import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

/**
 * `definition` holds the drag-and-drop graph: { nodes: [...], edges: [...] }
 * Node types: trigger (ncr_created, capa_closed, ...), condition, action.
 */
export const workflowDefinitions = pgTable("workflow_definitions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  module: text("module"), // ncr, capa, audits, ...
  isActive: text("is_active").notNull().default("true"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  workflowId: integer("workflow_id").references(() => workflowDefinitions.id).notNull(),
  context: jsonb("context").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("running"), // running, completed, failed
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
