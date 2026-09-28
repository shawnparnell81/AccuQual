import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, maskSecret, decryptSecret } from "../company/crypto.js";
import { loadCompanyForSettings, getFeasibilitySettings, assertAccessibleRequiredDocuments, getInventorySettings, getErpSyncSettings, getSupplierRiskSettings, getReceivingSettings, getQualityAutomationSettingsStored } from "./settings.service.js";
import { resolveQualityAutomationSettings } from "../quality-automation/logic.js";
import { triggerErpSync } from "./settings.erpSync.js";

// ============================================================
// Settings → Feasibility Module integration
// ============================================================

export const getFeasibilitySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  res.json(getFeasibilitySettings(co));
});

export const updateFeasibilitySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  if (Array.isArray(req.body.requiredDocuments)) await assertAccessibleRequiredDocuments(req.db!, req.body.requiredDocuments);
  const merged = { ...getFeasibilitySettings(co), ...req.body };

  const [updated] = await req.db!.update(company).set({ feasibilitySettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "FeasibilitySettings",
    entityId: 1,
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
  const co = await loadCompanyForSettings(req.db!);
  res.json(getInventorySettings(co));
});

export const updateInventorySettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const merged = { ...getInventorySettings(co), ...req.body };

  const [updated] = await req.db!.update(company).set({ inventorySettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "InventorySettings",
    entityId: 1,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(updated!.inventorySettings);
});

// ============================================================
// Settings → ERP Sync Engine
// ============================================================

/** Never returns the real secret — a masked display string plus whether one is set. */
export const getErpSyncSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const config = getErpSyncSettings(co);
  res.json({
    schedule: config.schedule ?? null,
    direction: config.direction ?? null,
    modulesEnabled: config.modulesEnabled ?? [],
    conflictRules: config.conflictRules ?? {},
    retryPolicy: config.retryPolicy ?? {},
    accountId: config.accountId ?? null,
    webhookUrl: config.webhookUrl ?? null,
    hasWebhookSecret: !!config.webhookSecretEncrypted,
    maskedWebhookSecret: config.webhookSecretEncrypted ? maskSecret(decryptSecret(config.webhookSecretEncrypted)) : null,
    statusHistory: config.statusHistory ?? [],
  });
});

export const updateErpSyncSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const { webhookSecret, webhookUrl, accountId, ...rest } = req.body as {
    webhookSecret?: string;
    webhookUrl?: string;
    accountId?: string;
  } & Record<string, unknown>;

  const merged = { ...getErpSyncSettings(co), ...rest };
  if (webhookUrl !== undefined) merged.webhookUrl = webhookUrl === "" ? undefined : webhookUrl;
  if (accountId !== undefined) {
    const trimmed = accountId.trim();
    if (trimmed) merged.accountId = trimmed;
    else delete merged.accountId;
  }
  if (webhookSecret !== undefined) merged.webhookSecretEncrypted = encryptSecret(webhookSecret);

  const [updated] = await req.db!.update(company).set({ erpSyncSettings: merged }).returning();

  // Never log the secret itself, encrypted or not.
  await recordAuditTrail(req.db!, {
    entityType: "ErpSyncSettings",
    entityId: 1,
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
    accountId: result.accountId ?? null,
    webhookUrl: result.webhookUrl ?? null,
    hasWebhookSecret: !!result.webhookSecretEncrypted,
    statusHistory: result.statusHistory ?? [],
  });
});

/**
 * POST /settings/erp-sync/test — reads the saved NetSuite account details.
 * Does not call NetSuite or deliver a webhook. A live sync only runs from
 * POST /settings/erp-sync/trigger, and only when someone clicks it.
 */
export const testErpConnectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const config = getErpSyncSettings(co);
  const accountId = config.accountId?.trim() ?? "";
  const webhookUrl = config.webhookUrl?.trim() ?? "";
  if (!accountId && !webhookUrl) {
    res.json({ connected: false, message: "Not connected yet" });
    return;
  }
  res.json({
    connected: true,
    message: accountId ? `NetSuite account ${accountId} is saved.` : "NetSuite webhook URL is saved.",
  });
});

// ============================================================
// Settings → Supplier Risk (Phase 7) — weights for the Supplier Quality
// Risk Score's 7 factors; see companies.ts's own schema comment for why this
// lives here rather than on PlatformAdminPage.
// ============================================================

export const getSupplierRiskSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  res.json(getSupplierRiskSettings(co));
});

export const updateSupplierRiskSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const merged = { ...getSupplierRiskSettings(co), ...req.body };

  const [updated] = await req.db!.update(company).set({ supplierRiskWeights: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "SupplierRiskSettings",
    entityId: 1,
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

export const getQualityAutomationSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  res.json(resolveQualityAutomationSettings(getQualityAutomationSettingsStored(co)));
});

export const updateQualityAutomationSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const merged = { ...getQualityAutomationSettingsStored(co), ...req.body };
  const [updated] = await req.db!.update(company).set({ qualityAutomationSettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "QualityAutomationSettings",
    entityId: 1,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });
  res.json(resolveQualityAutomationSettings(updated!.qualityAutomationSettings));
});

export const getReceivingSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  res.json(getReceivingSettings(co));
});

export const updateReceivingSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompanyForSettings(req.db!);
  const merged = { ...getReceivingSettings(co), ...req.body };

  const [updated] = await req.db!.update(company).set({ receivingSettings: merged }).returning();
  await recordAuditTrail(req.db!, {
    entityType: "ReceivingSettings",
    entityId: 1,
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
  const result = await triggerErpSync(req.db!, req.user?.id, event ? { on: event, statusValue } : undefined);
  res.status(202).json(result);
});
