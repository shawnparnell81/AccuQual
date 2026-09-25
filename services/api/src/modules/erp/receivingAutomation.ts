import { and, eq, inArray } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { erpReceivingLineItems, erpReceivingDocuments, erpPoLineItems, erpPurchaseOrders, type ErpReceivingLineItem } from "../../drizzle/schema/erp.js";
import { ncr, type Ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { loadTenantForSettings } from "../settings/settings.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPA_THRESHOLD = 3;
const DEFAULT_CAPA_WINDOW_DAYS = 90;

/**
 * Phase 8 task 6 — "rejected receiving inspection can auto-create NCR."
 * Reads Settings → Receiving (tenants.receivingSettings) to decide whether
 * this specific disposition qualifies: the rejection/quarantine toggle for
 * that disposition must be on, AND (if the tenant configured a defect
 * category allow-list) the inspection's defectCategory must be in it.
 * Returns the created NCR (or null if settings say not to create one) so
 * the caller can chain it into checkCapaEscalation below without a second
 * lookup.
 */
export async function maybeAutoCreateNcr(
  db: TenantDb,
  tenantId: number,
  line: ErpReceivingLineItem,
  disposition: "rejected" | "quarantined",
  supplierId: number | null,
  defectCategory: string | undefined,
  performedBy: number | undefined,
  siteId?: number | null
): Promise<Ncr | null> {
  const tenant = await loadTenantForSettings(db, tenantId);
  const settings = tenant.receivingSettings ?? {};
  const enabled = disposition === "rejected" ? settings.autoCreateNcrOnRejection : settings.autoCreateNcrOnQuarantine;
  if (!enabled) return null;

  const categoryFilter = settings.autoCreateNcrDefectCategories ?? [];
  if (categoryFilter.length > 0 && (!defectCategory || !categoryFilter.includes(defectCategory))) return null;

  const [poLine] = await db.select().from(erpPoLineItems).where(eq(erpPoLineItems.id, line.poLineItemId));
  const [item] = poLine ? await db.select({ sku: inventoryItems.sku, description: inventoryItems.description }).from(inventoryItems).where(eq(inventoryItems.id, poLine.itemId)) : [];
  const [supplier] = supplierId ? await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)) : [];

  const title = `Receiving ${disposition}: ${item?.sku ?? `Item #${poLine?.itemId}`}${supplier ? ` from ${supplier.name}` : ""}`;
  const description = `Auto-created from a ${disposition} receiving inspection (Receiving Line Item #${line.id}, qty ${line.quantityReceived}${item?.description ? `, ${item.description}` : ""}).`;

  const [created] = await db
    .insert(ncr)
    .values({
      title,
      description,
      severity: disposition === "rejected" ? "high" : "medium",
      supplierId: supplierId ?? undefined,
      receivingLineItemId: line.id,
      createdBy: performedBy,
      ...(siteId ? { siteId } : {}),
    })
    .returning();

  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: created!.id,
    action: "create",
    changes: { message: "NCR auto-created from Receiving", receivingLineItemId: line.id, disposition, supplierId },
    performedBy,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "ncr", event: "auto_created_from_receiving", entityId: created!.id });

  return created!;
}

/**
 * Phase 8 task 7 — "repeated receiving defects can escalate to CAPA."
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
export async function checkCapaEscalation(db: TenantDb, tenantId: number, supplierId: number, triggeringNcrId: number | undefined, performedBy: number | undefined, siteId?: number | null): Promise<void> {
  const tenant = await loadTenantForSettings(db, tenantId);
  const settings = tenant.receivingSettings ?? {};
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
