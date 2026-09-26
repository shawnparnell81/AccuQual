import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * `definition` holds the drag-and-drop graph: { nodes: [...], edges: [...] }
 * Node types: trigger (ncr_created, capa_closed, ...), condition, action.
 *
 * Phase 9 — `version`/`versionHistory` added for real edit versioning (task
 * 7): every PATCH that changes `definition` bumps `version` and appends the
 * PRIOR definition (not the new one) to `versionHistory`, so a company can
 * see exactly what a workflow looked like before each edit. Capped in
 * application code (workflow.controller.ts), not here, at 20 entries —
 * same "human-edited config, not an unbounded ledger" convention
 * `erpSyncSettings.statusHistory` already established.
 */
export const workflowDefinitions = pgTable("workflow_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: text("module"), // ncr, capa, audits, ...
  isActive: text("is_active").notNull().default("true"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  versionHistory: jsonb("version_history").$type<{ version: number; definition: Record<string, unknown>; updatedAt: string; updatedBy: number | null }[]>().default([]),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflowDefinitions.id).notNull(),
  context: jsonb("context").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("running"), // running, waiting_approval, completed, failed
  error: text("error"),
  // Phase 9 task 9 — Workflow Simulation Mode. A simulated run executes the
  // exact same graph-walking logic (so conditions/RBAC/reachability are
  // genuinely exercised) but every action handler skips its real side
  // effect (see workflowActions.ts's own comment) — kept as a real,
  // separate boolean rather than overloading `status` with a 4th value, so
  // every existing "running|completed|failed" consumer keeps working
  // unchanged and a health check can trivially exclude simulated runs from
  // "last successful/failed transition" (task 8).
  simulated: boolean("simulated").notNull().default(false),
  // Execution model: which published version of the workflow this run used, the node it is at (or died on), and — for a run
  // paused on an approval node — the saved position (see workflow-engine.ts's WorkflowRunState) so it can be resumed.
  definitionVersion: integer("definition_version"),
  currentNodeId: text("current_node_id"),
  runState: jsonb("run_state").$type<{ stack: string[]; visited: string[]; waitingNodeId: string | null }>(),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
