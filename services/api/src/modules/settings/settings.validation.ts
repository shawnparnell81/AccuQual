import { z } from "zod";

// Mirrors feasibility.validation.ts's RISK_LEVELS exactly — this seeds each
// of the 7 fixed assessment rows' own riskLevel on create (see
// feasibility.controller.ts's createFeasibilityHandler).
export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const updateFeasibilitySettingsSchema = z.object({
  defaultRiskLevel: z.enum(RISK_LEVELS).optional(),
  autoAssignOwner: z.boolean().optional(),
  requiredDocuments: z.array(z.string().min(1)).optional(),
  notificationsEnabled: z.boolean().optional(),
});

export const AUDIT_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"] as const;
export const COST_METHODS = ["average", "latest"] as const;

export const updateInventorySettingsSchema = z.object({
  agingRules: z
    .object({
      warningDays: z.coerce.number().int().min(0).optional(),
      criticalDays: z.coerce.number().int().min(0).optional(),
    })
    .optional(),
  reservationRules: z
    .object({
      allowNegativeAllocation: z.boolean().optional(),
      autoReleaseAfterDays: z.coerce.number().int().min(1).optional(),
    })
    .optional(),
  autoGenerateLotNumbers: z.boolean().optional(),
  lotNumberFormat: z.string().max(100).optional(),
  autoGenerateSerialNumbers: z.boolean().optional(),
  serialNumberFormat: z.string().max(100).optional(),
  costAdjustmentRules: z
    .object({
      method: z.enum(COST_METHODS).optional(),
      roundingPrecision: z.coerce.number().int().min(0).max(6).optional(),
    })
    .optional(),
  auditFrequency: z.enum(AUDIT_FREQUENCIES).optional(),
});

export const SYNC_SCHEDULES = ["manual", "hourly", "daily"] as const;
export const SYNC_DIRECTIONS = ["push", "pull", "bidirectional"] as const;
export const SYNC_MODULES = ["inventory", "suppliers", "purchaseOrders", "workOrders"] as const;
export const CONFLICT_STRATEGIES = ["local_wins", "remote_wins", "manual_review"] as const;

export const updateErpSyncSettingsSchema = z.object({
  schedule: z.enum(SYNC_SCHEDULES).optional(),
  direction: z.enum(SYNC_DIRECTIONS).optional(),
  modulesEnabled: z.array(z.enum(SYNC_MODULES)).optional(),
  conflictRules: z.object({ resolutionStrategy: z.enum(CONFLICT_STRATEGIES).optional() }).optional(),
  retryPolicy: z
    .object({
      maxRetries: z.coerce.number().int().min(0).max(5).optional(),
      backoffSeconds: z.coerce.number().int().min(0).max(10).optional(),
    })
    .optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")), // "" clears it, same convention as tenant.validation.ts's hexColor()
  // Plaintext in the request only — encrypted before it ever touches the
  // database, same convention as tenant.validation.ts's updateAiConfigSchema.
  webhookSecret: z.string().min(1).optional(),
});
