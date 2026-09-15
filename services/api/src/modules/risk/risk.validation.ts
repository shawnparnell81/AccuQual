import { z } from "zod";

export const RISK_CATEGORIES = ["supplier", "process", "product", "safety", "regulatory", "other"] as const;
export const RISK_SOURCE_TYPES = ["NCR", "Supplier", "Receiving", "WorkOrder", "Customer", "Manual"] as const;
export const RISK_STATUSES = ["open", "mitigation", "monitoring", "closed"] as const;
export const MITIGATION_STATUSES = ["planned", "in_progress", "completed"] as const;

export const createRiskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(RISK_CATEGORIES).optional(),
  sourceType: z.enum(RISK_SOURCE_TYPES).optional(),
  sourceId: z.coerce.number().int().optional(),
  severity: z.coerce.number().int().min(1).max(5).optional(),
  probability: z.coerce.number().int().min(1).max(5).optional(),
  processArea: z.string().optional(),
  department: z.string().optional(),
  ownerId: z.coerce.number().int().optional(),
});

// Deliberately excludes `status` — status only ever changes through the
// dedicated transition endpoints below (start-mitigation/start-monitoring/
// close), each with its own workflow + department validation. Same reason
// workOrders.controller.ts's updateWorkOrderHandler doesn't accept a raw
// status field either.
export const updateRiskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(RISK_CATEGORIES).optional(),
  severity: z.coerce.number().int().min(1).max(5).optional(),
  probability: z.coerce.number().int().min(1).max(5).optional(),
  processArea: z.string().optional(),
  department: z.string().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
  // Present only when this update is applying an AI suggestion the user
  // just confirmed — see risk.controller.ts's updateRiskHandler and
  // risk.ai.ts. Never persisted as a column, only used to label the audit
  // trail entry "ai_suggestion_accepted" instead of a plain edit.
  aiSuggestionId: z.coerce.number().int().optional(),
});

export const addFmeaItemSchema = z.object({
  failureMode: z.string().min(1),
  effect: z.string().optional(),
  cause: z.string().optional(),
  severity: z.number().int().min(1).max(10),
  occurrence: z.number().int().min(1).max(10),
  detection: z.number().int().min(1).max(10),
  recommendedAction: z.string().optional(),
});

export const createMitigationSchema = z.object({
  action: z.string().min(1),
  dueDate: z.coerce.date().optional(),
  ownerId: z.coerce.number().int().optional(),
  aiSuggestionId: z.coerce.number().int().optional(),
});

export const updateMitigationSchema = z.object({
  action: z.string().min(1).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
  status: z.enum(MITIGATION_STATUSES).optional(),
});
