import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, maskSecret, decryptSecret } from "../company/crypto.js";
import { loadTenantForSettings, getFeasibilitySettings, assertAccessibleRequiredDocuments, getInventorySettings, getErpSyncSettings, getSupplierRiskSettings, getReceivingSettings } from "./settings.service.js";
import { triggerErpSync } from "./settings.erpSync.js";

// ============================================================
// Settings → Feasibility Module integration
// ============================================================

export const getFeasibilitySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  res.json(getFeasibilitySettings(tenant));
});

export const updateFeasibilitySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  if (Array.isArray(req.body.requiredDocuments)) await assertAccessibleRequiredDocuments(req.db!, req.body.requiredDocuments);
  const merged = { ...getFeasibilitySettings(tenant), ...req.body };

  const [updated] = await req.db!.update(company).set({ feasibilitySettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "FeasibilitySettings",
    entityId: req.tenantId!,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(updated!.feasibilitySettings);
});

// ============================================================
// Settings → Inventory Module expansion
// ============================================================

export const getInventorySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  res.json(getInventorySettings(tenant));
});

export const updateInventorySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  const merged = { ...getInventorySettings(tenant), ...req.body };

  const [updated] = await req.db!.update(company).set({ inventorySettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "InventorySettings",
    entityId: req.tenantId!,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(updated!.inventorySettings);
});

// ============================================================
// Settings → ERP Sync Engine
// ============================================================

/** Never returns the real secret — a masked display string + whether one is set, same convention as tenant.controller.ts's getAiConfigHandler. */
export const getErpSyncSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  const config = getErpSyncSettings(tenant);
  res.json({
    schedule: config.schedule ?? null,
    direction: config.direction ?? null,
    modulesEnabled: config.modulesEnabled ?? [],
    conflictRules: config.conflictRules ?? {},
    retryPolicy: config.retryPolicy ?? {},
    webhookUrl: config.webhookUrl ?? null,
    hasWebhookSecret: !!config.webhookSecretEncrypted,
    maskedWebhookSecret: config.webhookSecretEncrypted ? maskSecret(decryptSecret(config.webhookSecretEncrypted)) : null,
    statusHistory: config.statusHistory ?? [],
  });
});

export const updateErpSyncSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  const { webhookSecret, webhookUrl, ...rest } = req.body as { webhookSecret?: string; webhookUrl?: string } & Record<string, unknown>;

  const merged = { ...getErpSyncSettings(tenant), ...rest };
  if (webhookUrl !== undefined) merged.webhookUrl = webhookUrl === "" ? undefined : webhookUrl;
  if (webhookSecret !== undefined) merged.webhookSecretEncrypted = encryptSecret(webhookSecret);

  const [updated] = await req.db!.update(company).set({ erpSyncSettings: merged }).returning();

  // Never log the secret itself, encrypted or not — same convention as tenant.controller.ts's updateAiConfigHandler.
  await recordAuditTrail(req.db!, {
    entityType: "ErpSyncSettings",
    entityId: req.tenantId!,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body), webhookSecretChanged: webhookSecret !== undefined },
    performedBy: req.user?.id,
  });

  const result = updated!.erpSyncSettings ?? {};
  res.json({
    schedule: result.schedule ?? null,
    direction: result.direction ?? null,
    modulesEnabled: result.modulesEnabled ?? [],
    conflictRules: result.conflictRules ?? {},
    retryPolicy: result.retryPolicy ?? {},
    webhookUrl: result.webhookUrl ?? null,
    hasWebhookSecret: !!result.webhookSecretEncrypted,
    statusHistory: result.statusHistory ?? [],
  });
});

// ============================================================
// Settings → Supplier Risk (Phase 7) — weights for the Supplier Quality
// Risk Score's 7 factors; see tenants.ts's own schema comment for why this
// lives here rather than on PlatformAdminPage.
// ============================================================

export const getSupplierRiskSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  res.json(getSupplierRiskSettings(tenant));
});

export const updateSupplierRiskSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  const merged = { ...getSupplierRiskSettings(tenant), ...req.body };

  const [updated] = await req.db!.update(company).set({ supplierRiskWeights: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "SupplierRiskSettings",
    entityId: req.tenantId!,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(updated!.supplierRiskWeights);
});

// ============================================================
// Settings → Receiving (Phase 8) — see receivingAutomation.ts for exactly
// how each field is read.
// ============================================================

export const getReceivingSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  res.json(getReceivingSettings(tenant));
});

export const updateReceivingSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenantForSettings(req.db!);
  const merged = { ...getReceivingSettings(tenant), ...req.body };

  const [updated] = await req.db!.update(company).set({ receivingSettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "ReceivingSettings",
    entityId: req.tenantId!,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(updated!.receivingSettings);
});

/**
 * POST /settings/erp-sync/trigger — the real (manual) run of the sync
 * engine. See settings.erpSync.ts's own comment on why this is the only way
 * a sync ever actually runs (no background scheduler exists).
 */
export const triggerErpSyncHandler = asyncHandler(async (req: Request, res: Response) => {
  const { event, statusValue } = req.body as { event?: "create" | "update" | "statusChange" | "workflowEvent"; statusValue?: string };
  const result = await triggerErpSync(req.db!, req.tenantId!, req.user?.id, event ? { on: event, statusValue } : undefined);
  res.status(202).json(result);
});
