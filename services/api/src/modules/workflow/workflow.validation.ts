import { z } from "zod";

export const nodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["trigger", "condition", "action", "integration", "approval", "parallel", "end"]),
  kind: z.string().max(100), // e.g. "ncr_created", "severity_equals", "assign_user", "create_capa", "send_email"
  config: z.record(z.string(), z.unknown()).default({}),
  label: z.string().max(200).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  branch: z.string().max(40).optional(),
  label: z.string().max(200).optional(),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(2000),
});

/** What a draft version stores: the graph plus the descriptive metadata the canvas edits. */
export const workflowPayloadSchema = workflowDefinitionSchema.extend({
  metadata: z
    .object({
      name: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      category: z.string().max(100).optional(),
      module: z.string().max(100).optional(),
      allowLoops: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1),
  module: z.string().optional(),
  // Optional: the canvas starts a new workflow blank; a template supplies a starting graph. Either way it begins as a draft.
  definition: workflowDefinitionSchema.default({ nodes: [], edges: [] }),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
