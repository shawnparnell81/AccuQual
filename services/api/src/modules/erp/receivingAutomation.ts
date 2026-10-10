import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { erpReceivingLineItems, erpReceivingDocuments, erpPoLineItems, erpPurchaseOrders, type ErpReceivingLineItem } from "../../drizzle/schema/erp.js";
import { type Ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { loadCompanyForSettings } from "../settings/settings.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPA_THRESHOLD = 3;
const DEFAULT_CAPA_WINDOW_DAYS = 90;

/**
 * A rejected or quarantined receiving line does not open an NCR.
 * Create NCR on that line is the only path. The settings flags are ignored.
 */
export async function maybeAutoCreateNcr(
  _db: Db,
  _line: ErpReceivingLineItem,
  _disposition: "rejected" | "quarantined",
  _supplierId: number | null,
  _defectCategory: string | undefined,
  _performedBy: number | undefined,
  _siteId?: number | null,
): Promise<Ncr | null> {
  return null;
}

/**
 * "repeated receiving defects can escalate to CAPA."
 * Reuses the exact recurrence-detection SHAPE Phase 7's
 * supplier.qualityRisk.ts already established (a real count of qualifying
 * events for one supplier within a rolling window, compared against a
 * configurable threshold) rather than inventing a new pattern. Counts
 * rejected/quarantined receiving line items for this supplier within
 * `capaEscalationWindowDays` (default 90); if the count meets
 * `capaEscalationThreshold` (default 3) AND no CAPA already escalated this
 * way for this supplier still sits open, auto-creates one — the "still
 * open" check is what stops every subsequent rejection from spawning a
 * duplicate escalation once the threshold is already met once.
 */
export async function checkCapaEscalation(db: Db, supplierId: number, triggeringNcrId: number | undefined, performedBy: number | undefined, siteId?: number | null): Promise<void> {
  const co = await loadCompanyForSettings(db);
  const settings = co.receivingSettings ?? {};
  const threshold = settings.capaEscalationThreshold ?? DEFAULT_CAPA_THRESHOLD;
  const windowDays = settings.capaEscalationWindowDays ?? DEFAULT_CAPA_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const existingOpenEscalation = await db
    .select({ id: capa.id })
    .from(capa)
    .where(and(eq(capa.supplierId, supplierId), eq(capa.escalationSource, "receiving_recurrence"), inArray(capa.status, ["open", "in_progress", "verifying"])));
  if (existingOpenEscalation.length > 0) return;

  const supplierPoIds = await db.select({ id: erpPurchaseOrders.id }).from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.supplierId, supplierId)));
  if (supplierPoIds.length === 0) return;
  const poLineIds = await db
    .select({ id: erpPoLineItems.id })
    .from(erpPoLineItems)
    .where(inArray(erpPoLineItems.purchaseOrderId, supplierPoIds.map((p) => p.id)));
  if (poLineIds.length === 0) return;

  const rejectedLines = await db
    .select({ id: erpReceivingLineItems.id, receivingDocumentId: erpReceivingLineItems.receivingDocumentId })
    .from(erpReceivingLineItems)
    .where(and(inArray(erpReceivingLineItems.poLineItemId, poLineIds.map((l) => l.id)), inArray(erpReceivingLineItems.status, ["rejected", "quarantined"])));
  if (rejectedLines.length < threshold) return;

  const docs = await db
    .select({ id: erpReceivingDocuments.id, createdAt: erpReceivingDocuments.createdAt })
    .from(erpReceivingDocuments)
    .where(inArray(erpReceivingDocuments.id, rejectedLines.map((l) => l.receivingDocumentId)));
  const withinWindow = docs.filter((d) => d.createdAt && d.createdAt >= since).length;
  if (withinWindow < threshold) return;

  const [created] = await db
    .insert(capa)
    .values({
      ncrId: triggeringNcrId,
      rootCause: `Recurring receiving rejections/quarantines from this supplier — ${withinWindow} qualifying event(s) in the last ${windowDays} days (threshold: ${threshold}).`,
      status: "open",
      escalationSource: "receiving_recurrence",
      supplierId,
      ...(siteId ? { siteId } : {}),
    })
    .returning();

  await recordAuditTrail(db, {
    entityType: "CAPA",
    entityId: created!.id,
    action: "create",
    changes: { message: "CAPA escalation triggered from Receiving", supplierId, occurrences: withinWindow, threshold, windowDays },
    performedBy,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "escalated_from_receiving", entityId: created!.id });
}
