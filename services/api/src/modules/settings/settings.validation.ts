import { z } from "zod";
import { REQUIRED_DOCUMENT_ID } from "./requiredDocuments.js";

// Mirrors feasibility.validation.ts's RISK_LEVELS exactly — this seeds each
// of the 7 fixed assessment rows' own riskLevel on create (see
// feasibility.controller.ts's createFeasibilityHandler).
export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const updateFeasibilitySettingsSchema = z.object({
  defaultRiskLevel: z.enum(RISK_LEVELS).optional(),
  autoAssignOwner: z.boolean().optional(),
  // Controlled-document ids (documents.id), not free-text names. Existence,
  // tenant access, and duplicates are checked in the settings controller.
  requiredDocuments: z.array(z.string().regex(REQUIRED_DOCUMENT_ID, "Must be an existing document id")).optional(),
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

// Optional body for POST /settings/erp-sync/trigger — see settings.erpSync.ts's
// own comment on `event`. Omitted entirely, the endpoint keeps its original
// "sync every enabled module" behavior.
export const triggerErpSyncSchema = z.object({
  event: z.enum(["create", "update", "statusChange", "workflowEvent"]).optional(),
  statusValue: z.string().optional(),
});

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

/**
 * Settings → Supplier Risk (Phase 7) — weights for the Supplier Quality
 * Risk Score's 7 factors (see modules/supplier/supplier.qualityRisk.ts).
 * Non-negative, uncapped — the score normalizes by the sum of whatever
 * weights are set, so a tenant emphasizing one factor doesn't need every
 * other one rebalanced by hand.
 */
export const updateSupplierRiskSettingsSchema = z.object({
  ncr: z.coerce.number().min(0).optional(),
  capa: z.coerce.number().min(0).optional(),
  capaRecurrence: z.coerce.number().min(0).optional(),
  delivery: z.coerce.number().min(0).optional(),
  defectRate: z.coerce.number().min(0).optional(),
  warranty: z.coerce.number().min(0).optional(),
  responsiveness: z.coerce.number().min(0).optional(),
});

/** Settings → Receiving (Phase 8) — read by erp/receivingAutomation.ts. */
export const updateReceivingSettingsSchema = z.object({
  autoCreateNcrOnRejection: z.boolean().optional(),
  autoCreateNcrOnQuarantine: z.boolean().optional(),
  autoCreateNcrDefectCategories: z.array(z.string()).optional(),
  capaEscalationThreshold: z.coerce.number().int().min(1).optional(),
  capaEscalationWindowDays: z.coerce.number().int().min(1).optional(),
});
