import { and, eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { erpReceivingLineItems, erpPoLineItems, erpPurchaseOrders, type ErpReceivingLineItem } from "../../drizzle/schema/erp.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { maybeAutoCreateNcr, checkCapaEscalation } from "./receivingAutomation.js";
import { openFromReceivingLine, resolveFromReceivingLine, linkNcrFromReceiving } from "../quarantine/quarantine.service.js";

/**
 * Phase 8 task 1 — the 7 structured receiving states the brief names,
 * modeled as a real state machine on erp_receiving_line_items.status
 * (previously no status/disposition concept existed at all — a line was
 * just "how much arrived"). Quality owns every inspection-outcome
 * transition (pending_inspection → ... → a disposition); material_management
 * (which physically handles the goods) may only move a line from its
 * default "received" into the inspection queue.
 */
export const RECEIVING_TRANSITIONS: Record<string, string[]> = {
  received: ["pending_inspection"],
  pending_inspection: ["inspected"],
  inspected: ["accepted", "rejected", "quarantined", "disposition_required"],
  disposition_required: ["accepted", "rejected", "quarantined"],
  quarantined: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

const QUALITY_OWNED_TARGETS = new Set(["inspected", "accepted", "rejected", "quarantined", "disposition_required"]);

async function loadReceivingLineItem(db: TenantDb, tenantId: number, id: number): Promise<ErpReceivingLineItem> {
  const [row] = await db.select().from(erpReceivingLineItems).where(and(eq(erpReceivingLineItems.id, id), eq(erpReceivingLineItems.tenantId, tenantId)));
  if (!row) throw AppError.notFound("ReceivingLineItem");
  return row;
}

/** Resolves the real supplier behind a receiving line item — line → PO line → PO.supplierId — the one join every automation/reporting query in this phase needs. */
export async function getSupplierIdForReceivingLineItem(db: TenantDb, tenantId: number, lineItemId: number): Promise<number | null> {
  const [row] = await db
    .select({ supplierId: erpPurchaseOrders.supplierId })
    .from(erpReceivingLineItems)
    .innerJoin(erpPoLineItems, eq(erpReceivingLineItems.poLineItemId, erpPoLineItems.id))
    .innerJoin(erpPurchaseOrders, eq(erpPoLineItems.purchaseOrderId, erpPurchaseOrders.id))
    .where(and(eq(erpReceivingLineItems.id, lineItemId), eq(erpReceivingLineItems.tenantId, tenantId)));
  return row?.supplierId ?? null;
}

export interface TransitionOptions {
  department: string | null;
  isAdminOrPlatformAdmin: boolean;
  defectCategory?: string;
  notes?: string;
  performedBy: number | undefined;
  /** Plant the person is working in, so an auto-created issue stays on that plant. */
  siteId?: number | null;
}

/**
 * POST /erp/receiving-line-items/:id/status — the one write path for the
 * whole state machine above. On a transition INTO "rejected" or
 * "quarantined" specifically, chains into the Phase 8 task 6/7 automation
 * (NCR auto-trigger, then CAPA recurrence escalation) — see
 * receivingAutomation.ts for exactly what each does and why they're kept
 * as separate, individually-audited steps rather than one combined action.
 */
export async function transitionReceivingLineItem(db: TenantDb, tenantId: number, lineItemId: number, targetStatus: string, options: TransitionOptions) {
  const line = await loadReceivingLineItem(db, tenantId, lineItemId);
  const allowed = RECEIVING_TRANSITIONS[line.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw AppError.badRequest(`Cannot move a receiving line item from "${line.status}" to "${targetStatus}"`);
  }

  if (!options.isAdminOrPlatformAdmin) {
    if (QUALITY_OWNED_TARGETS.has(targetStatus)) {
      if (options.department !== "quality") throw AppError.forbidden(`Moving a receiving line item to "${targetStatus}" requires department: quality`);
    } else if (options.department !== "material_management" && options.department !== "quality") {
      throw AppError.forbidden(`This action requires department: material_management or quality`);
    }
  }

  const [updated] = await db.update(erpReceivingLineItems).set({ status: targetStatus }).where(eq(erpReceivingLineItems.id, lineItemId)).returning();
  await recordAuditTrail(db, {
    tenantId,
    entityType: "ErpReceivingLineItem",
    entityId: lineItemId,
    action: "status_change",
    changes: { from: line.status, to: targetStatus, notes: options.notes },
    performedBy: options.performedBy,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "receiving", event: targetStatus, entityId: lineItemId });

  // A line moving to "quarantined" really holds the stock (the quarantine module asks the inventory system to protect it); a line
  // leaving quarantine as accepted releases that hold, and one rejected stays held until it is returned or scrapped.
  const hold = targetStatus === "quarantined" ? await openFromReceivingLine(db, tenantId, lineItemId, options.performedBy) : null;
  if (line.status === "quarantined" && (targetStatus === "accepted" || targetStatus === "rejected")) {
    await resolveFromReceivingLine(db, tenantId, lineItemId, targetStatus, { id: options.performedBy ?? 0, roleName: options.isAdminOrPlatformAdmin ? "admin" : null });
  }

  if (targetStatus === "rejected" || targetStatus === "quarantined") {
    const supplierId = await getSupplierIdForReceivingLineItem(db, tenantId, lineItemId);
    const ncr = await maybeAutoCreateNcr(db, tenantId, updated!, targetStatus, supplierId, options.defectCategory, options.performedBy, options.siteId);
    if (hold && ncr) await linkNcrFromReceiving(db, tenantId, hold.id, ncr.id);
    if (supplierId) await checkCapaEscalation(db, tenantId, supplierId, ncr?.id, options.performedBy, ncr?.siteId);
  }

  return updated!;
}
