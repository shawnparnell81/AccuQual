import { z } from "zod";

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "condition", "action"]),
  kind: z.string(), // e.g. "ncr_created", "severity_equals", "assign_user", "create_capa", "send_email"
  config: z.record(z.string(), z.unknown()).default({}),
});

const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1),
  module: z.string().optional(),
  definition: workflowDefinitionSchema,
});

/** PATCH /workflow/:id — every field optional; only a real `definition` change bumps version/versionHistory (see workflow.controller.ts's updateHandler). */
export const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  module: z.string().nullable().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const runWorkflowSchema = z.object({
  context: z.record(z.string(), z.unknown()).default({}),
  // Phase 9 task 9 — Simulation Mode: walks the same graph/condition logic
  // but every action handler skips its real side effect (see
  // workflowActions.ts's own dryRun handling).
  simulate: z.boolean().default(false),
});
