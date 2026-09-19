import { createHmac } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { erpSyncErrors, type ErpErrorType, type ErpSyncErrorRow } from "../../drizzle/schema/erpSyncErrors.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { logger } from "../../utils/logger.js";
import { assertSafeWebhookUrl } from "../../utils/ssrfGuard.js";
import { env } from "../../config/env.js";
import { decryptSecret } from "../tenant/crypto.js";
import { loadTenantForSettings, getErpSyncSettings } from "../settings/settings.service.js";
import { getActivePresetCached } from "./erpPresets.service.js";
import { buildErpPayload, recordSyncError } from "./erpMappingEngine.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListErrorsFilters {
  module?: string;
  errorType?: ErpErrorType;
  presetVersion?: number;
  resolved?: boolean;
  since?: Date;
  until?: Date;
}

/** Newest-first, filtered + paginated — same limit/offset + count() shape as ai.controller.ts's listSuggestions. */
export async function listErrors(db: TenantDb, tenantId: number, filters: ListErrorsFilters, pagination: { limit?: number; offset?: number }) {
  const limit = Math.min(pagination.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const conditions = [eq(erpSyncErrors.tenantId, tenantId)];
  if (filters.module) conditions.push(eq(erpSyncErrors.module, filters.module));
  if (filters.errorType) conditions.push(eq(erpSyncErrors.errorType, filters.errorType));
  if (filters.presetVersion !== undefined) conditions.push(eq(erpSyncErrors.presetVersion, filters.presetVersion));
  if (filters.resolved === true) conditions.push(sql`${erpSyncErrors.resolvedAt} IS NOT NULL`);
  if (filters.resolved === false) conditions.push(sql`${erpSyncErrors.resolvedAt} IS NULL`);
  if (filters.since) conditions.push(gte(erpSyncErrors.createdAt, filters.since));
  if (filters.until) conditions.push(lte(erpSyncErrors.createdAt, filters.until));

  const [rows, totalRows] = await Promise.all([
    db.select().from(erpSyncErrors).where(and(...conditions)).orderBy(desc(erpSyncErrors.createdAt)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(erpSyncErrors).where(and(...conditions)),
  ]);
  return { rows, total: totalRows[0]?.total ?? 0, limit, offset };
}

export async function getError(db: TenantDb, tenantId: number, id: number): Promise<ErpSyncErrorRow> {
  const [row] = await db.select().from(erpSyncErrors).where(and(eq(erpSyncErrors.id, id), eq(erpSyncErrors.tenantId, tenantId)));
  if (!row) throw AppError.notFound("ERP sync error");
  return row;
}

export async function resolveError(db: TenantDb, tenantId: number, id: number, resolvedBy: number | undefined): Promise<ErpSyncErrorRow> {
  await getError(db, tenantId, id); // 404s if missing/not this tenant's
  const [updated] = await db
    .update(erpSyncErrors)
    .set({ resolvedAt: new Date(), resolvedBy })
    .where(and(eq(erpSyncErrors.id, id), eq(erpSyncErrors.tenantId, tenantId)))
    .returning();
  await recordAuditTrail(db, { tenantId, entityType: "ErpSyncError", entityId: id, action: "status_change", changes: { subAction: "resolved" }, performedBy: resolvedBy });
  return updated!;
}

/** One-shot webhook delivery attempt (no retry/backoff loop — this is a single manual re-attempt, not the scheduled sync's own retry policy). */
async function attemptWebhookDelivery(webhookUrl: string, webhookSecretEncrypted: string | null | undefined, payload: string): Promise<{ delivered: boolean; error?: string }> {
  if (env.NODE_ENV === "production") {
    try {
      await assertSafeWebhookUrl(webhookUrl);
    } catch (err) {
      return { delivered: false, error: err instanceof Error ? err.message : "Webhook URL failed validation" };
    }
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhookSecretEncrypted) {
      const secret = decryptSecret(webhookSecretEncrypted);
      headers["X-AccuQual-Signature"] = createHmac("sha256", secret).update(payload).digest("hex");
    }
    const res = await fetch(webhookUrl, { method: "POST", headers, body: payload });
    if (res.ok) return { delivered: true };
    return { delivered: false, error: `Webhook responded ${res.status}` };
  } catch (err) {
    return { delivered: false, error: err instanceof Error ? err.message : "Unknown error calling webhook" };
  }
}

/**
 * Retries just the ONE module the original error belongs to, not the
 * tenant's whole enabled-module set — a scoped re-attempt, not a full
 * re-trigger of the sync. On success, resolves the original row; on
 * failure, records a brand-new row (via recordSyncError, itself
 * non-throwing) and leaves the original exactly as it was, so the error
 * history stays an honest log rather than being overwritten in place.
 */
export async function retryError(db: TenantDb, tenantId: number, id: number, performedBy: number | undefined): Promise<{ resolved: boolean; error: ErpSyncErrorRow }> {
  const original = await getError(db, tenantId, id);
  if (original.resolvedAt) throw AppError.badRequest("This error is already resolved.");

  if (original.errorType === "erpApiError") {
    const tenant = await loadTenantForSettings(db, tenantId);
    const config = getErpSyncSettings(tenant);
    if (!config.webhookUrl) {
      await recordSyncError(db, { tenantId, module: original.module, presetId: original.presetId ?? undefined, presetVersion: original.presetVersion ?? undefined, stage: "erpApi", message: "No webhook URL configured — nothing to retry." });
      const [fresh] = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantId)).orderBy(desc(erpSyncErrors.id)).limit(1);
      return { resolved: false, error: fresh! };
    }
    const preset = original.presetId ? await getActivePresetCached(db, tenantId, original.module) : null;
    const mappedData = preset ? await buildErpPayload(db, tenantId, original.module, preset) : null;
    const payload = JSON.stringify({ tenantId, direction: config.direction ?? "push", modules: [original.module], triggeredAt: new Date().toISOString(), ...(mappedData ? { mappedData: { [original.module]: mappedData } } : {}) });
    const result = await attemptWebhookDelivery(config.webhookUrl, config.webhookSecretEncrypted, payload);
    if (result.delivered) {
      logger.info("ERP sync error retry succeeded", { tenantId, module: original.module, errorId: id });
      const resolved = await resolveError(db, tenantId, id, performedBy);
      return { resolved: true, error: resolved };
    }
    await recordSyncError(db, { tenantId, module: original.module, presetId: original.presetId ?? undefined, presetVersion: original.presetVersion ?? undefined, stage: "erpApi", message: result.error ?? "Webhook delivery failed.", details: { retryOf: id } });
    const [fresh] = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantId)).orderBy(desc(erpSyncErrors.id)).limit(1);
    return { resolved: false, error: fresh! };
  }

  // mappingError / validationError / transformError / triggerError / unexpectedError:
  // re-run mapping for this module against the tenant's CURRENT active preset
  // (may have since been fixed/edited) and see whether the same source
  // record(s) still fail.
  const preset = await getActivePresetCached(db, tenantId, original.module);
  if (!preset) {
    await recordSyncError(db, { tenantId, module: original.module, stage: undefined, message: `No active preset for module "${original.module}" — nothing to retry.` });
    const [fresh] = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantId)).orderBy(desc(erpSyncErrors.id)).limit(1);
    return { resolved: false, error: fresh! };
  }
  const result = await buildErpPayload(db, tenantId, original.module, preset);
  const stillFailing = result && result.errors.length > 0;
  if (!stillFailing) {
    logger.info("ERP sync error retry succeeded", { tenantId, module: original.module, errorId: id });
    const resolved = await resolveError(db, tenantId, id, performedBy);
    return { resolved: true, error: resolved };
  }
  // buildErpPayload already called recordSyncError internally for any
  // record still failing — no need to record a second, duplicate row here.
  const [fresh] = await db
    .select()
    .from(erpSyncErrors)
    .where(and(eq(erpSyncErrors.tenantId, tenantId), eq(erpSyncErrors.module, original.module)))
    .orderBy(desc(erpSyncErrors.id))
    .limit(1);
  return { resolved: false, error: fresh ?? original };
}
