import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db, pool } from "./index.js";
import { logger } from "../utils/logger.js";
import { company } from "../drizzle/schema/company.js";
import { users } from "../drizzle/schema/users.js";
import { suppliers } from "../drizzle/schema/supplier.js";
import { inventoryItems, inventoryStock, inventoryMovements } from "../drizzle/schema/inventory.js";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems } from "../drizzle/schema/erp.js";
import { ncr } from "../drizzle/schema/ncr.js";
import { capa } from "../drizzle/schema/capa.js";
import { eightD } from "../drizzle/schema/eightD.js";
import { supplier8dResponses } from "../drizzle/schema/supplierPortal.js";
import { customers } from "../drizzle/schema/customers.js";
import { warrantyClaims, warrantyClaimCosts, warrantyClaimWorkflow } from "../drizzle/schema/warranty.js";
import { rmaLogRecords } from "../drizzle/schema/rmaLog.js";
import { audits, auditItems } from "../drizzle/schema/audits.js";
import { trainingCourses, trainingAssignments } from "../drizzle/schema/training.js";
import { documents } from "../drizzle/schema/documents.js";
import { recordAuditTrail } from "../modules/audit-trail/audit-trail.service.js";
import { setContainment, setRootCause, setCorrectiveAction, close as closeNcr } from "../modules/ncr/ncr.service.js";
import { transitionReceivingLineItem } from "../modules/erp/receivingWorkflow.js";
import { receiveIntoLot } from "../modules/inventory/inventoryLots.service.js";
import { recomputeSupplierRiskScore } from "../modules/supplier/supplier.qualityRisk.js";
import { closeEventBusClient } from "../lib/eventBus.js";
import type { Db } from "../lib/requestDb.js";

/**
 * Phase 11 task 3/13 — demo-friendly seed data telling ONE coherent story
 * (a recurring supplier quality problem that flows through receiving → NCR
 * → CAPA escalation → 8D → warranty → RMA → a real, computed supplier risk
 * score) plus a second, healthy supplier for visual contrast on dashboards
 * that would otherwise show only one bar/row. Deliberately uses the app's
 * OWN real service functions wherever one exists (ncr.service.ts's
 * transition functions, receivingWorkflow.ts's transitionReceivingLineItem,
 * inventoryLots.service.ts's receiveIntoLot, supplier.qualityRisk.ts's
 * recomputeSupplierRiskScore) rather than raw inserts, so the seeded records
 * carry the exact same audit trail / form-sync / workflow-event side effects
 * a real user's actions would have produced — and so the CAPA escalation and
 * supplier risk score are the real automation actually firing on real data,
 * not hand-picked numbers. Deliberately does NOT flip any tenant-wide
 * automation toggle (e.g. receivingSettings.autoCreateNcrOnQuarantine) to
 * get there — that would change real automated behavior for this tenant
 * going forward as a side effect of seeding some sample rows, so the demo
 * NCR is created directly instead of by not relying on that toggle being on.
 *
 * Idempotent at a coarse level (checks for the demo supplier's existence
 * before doing anything) rather than per-row onConflictDoNothing — most of
 * these tables have no natural unique key besides `id` to conflict on. Run
 * `db:reset-demo-story` first if you want to re-seed from scratch.
 */

const DEMO_SUPPLIER_NAME = "Titan Components Inc.";
const HEALTHY_SUPPLIER_NAME = "Meridian Fasteners LLC";

async function main() {
  logger.info("Seeding AccuQual demo story data...");

  const [tenant] = await db.select().from(company).where(eq(company.code, "demo"));
  if (!tenant) throw new Error('Demo tenant not found — run "npm run db:seed" first.');
  const tenantId = tenant.id;
  const tdb = db as unknown as Db;

  const [existing] = await tdb.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.name, DEMO_SUPPLIER_NAME)));
  if (existing) {
    logger.info(`Demo story already seeded (supplier "${DEMO_SUPPLIER_NAME}" exists, id ${existing.id}) — run "npm run db:reset-demo-story" to re-seed. Exiting.`);
    await pool.end();
    return;
  }

  const [admin] = await tdb.select({ id: users.id }).from(users).where(and(eq(users.email, "admin@accuqual.local")));
  const performedBy = admin?.id;

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  // ---------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------
  const [titan] = await tdb.insert(suppliers).values({ name: DEMO_SUPPLIER_NAME, contactEmail: "quality@titancomponents.example", status: "active" }).returning();
  const [meridian] = await tdb.insert(suppliers).values({ name: HEALTHY_SUPPLIER_NAME, contactEmail: "sales@meridianfasteners.example", status: "active" }).returning();

  // ---------------------------------------------------------------------
  // Inventory items
  // ---------------------------------------------------------------------
  const [bracket] = await tdb
    .insert(inventoryItems)
    .values({ sku: "TC-4400-BRKT", description: "Titan Bracket Assembly 4400", itemType: "raw_material", unitOfMeasure: "ea", defaultSupplierId: titan!.id, minLevel: "50", unitCost: "12.50" })
    .returning();
  const [gasket] = await tdb
    .insert(inventoryItems)
    .values({ sku: "MF-2200-GSKT", description: "Meridian Gasket 2200", itemType: "raw_material", unitOfMeasure: "ea", defaultSupplierId: meridian!.id, minLevel: "100", unitCost: "1.75" })
    .returning();

  // ---------------------------------------------------------------------
  // Titan story: 3 receiving events over the last ~75 days, 2 quarantined +
  // 1 rejected, real transitionReceivingLineItem() calls so the real
  // checkCapaEscalation() automation (Phase 8) decides whether to escalate —
  // not a hand-picked CAPA row.
  // ---------------------------------------------------------------------
  const receivingOutcomes: { daysAgo: number; disposition: "quarantined" | "rejected"; qty: number }[] = [
    { daysAgo: 75, disposition: "quarantined", qty: 200 },
    { daysAgo: 40, disposition: "quarantined", qty: 150 },
    { daysAgo: 10, disposition: "rejected", qty: 180 },
  ];
  let firstQuarantinedLineId: number | null = null;

  for (const outcome of receivingOutcomes) {
    const [po] = await tdb
      .insert(erpPurchaseOrders)
      .values({ supplierId: titan!.id, createdBy: performedBy, status: "received", expectedDeliveryDate: daysAgo(outcome.daysAgo + 5) })
      .returning();
    const [poLine] = await tdb.insert(erpPoLineItems).values({ purchaseOrderId: po!.id, itemId: bracket!.id, quantity: outcome.qty, unitCost: "12.50" }).returning();
    const [doc] = await tdb.insert(erpReceivingDocuments).values({ purchaseOrderId: po!.id, createdBy: performedBy }).returning();
    const [line] = await tdb.insert(erpReceivingLineItems).values({ receivingDocumentId: doc!.id, poLineItemId: poLine!.id, quantityReceived: outcome.qty, lotNumber: `TC-LOT-${outcome.daysAgo}` }).returning();

    await receiveIntoLot(tdb, {
      itemId: bracket!.id,
      lotNumber: `TC-LOT-${outcome.daysAgo}`,
      supplierId: titan!.id,
      purchaseOrderId: po!.id,
      receivingLineItemId: line!.id,
      quantity: outcome.qty,
    });
    await tdb.insert(inventoryMovements).values({ itemId: bracket!.id, movementType: "receive", quantity: String(outcome.qty), lotNumber: `TC-LOT-${outcome.daysAgo}`, referenceType: "receiving", referenceId: String(doc!.id), performedBy, performedAt: daysAgo(outcome.daysAgo) });

    const transitionOpts = { department: "quality", isAdminOrPlatformAdmin: true, performedBy, notes: "Dimensional check failed — bracket mounting holes out of tolerance" };
    await transitionReceivingLineItem(tdb, line!.id, "pending_inspection", transitionOpts);
    await transitionReceivingLineItem(tdb, line!.id, "inspected", transitionOpts);
    await transitionReceivingLineItem(tdb, line!.id, outcome.disposition, transitionOpts);

    if (outcome.disposition === "quarantined" && firstQuarantinedLineId === null) firstQuarantinedLineId = line!.id;
  }

  // A clean receiving event for the healthy supplier, for dashboard contrast.
  {
    const [po] = await tdb.insert(erpPurchaseOrders).values({ supplierId: meridian!.id, createdBy: performedBy, status: "received", expectedDeliveryDate: daysAgo(15) }).returning();
    const [poLine] = await tdb.insert(erpPoLineItems).values({ purchaseOrderId: po!.id, itemId: gasket!.id, quantity: 500, unitCost: "1.75" }).returning();
    const [doc] = await tdb.insert(erpReceivingDocuments).values({ purchaseOrderId: po!.id, createdBy: performedBy }).returning();
    const [line] = await tdb.insert(erpReceivingLineItems).values({ receivingDocumentId: doc!.id, poLineItemId: poLine!.id, quantityReceived: 500, lotNumber: "MF-LOT-20" }).returning();
    await receiveIntoLot(tdb, { itemId: gasket!.id, lotNumber: "MF-LOT-20", supplierId: meridian!.id, purchaseOrderId: po!.id, receivingLineItemId: line!.id, quantity: 500 });
    await tdb.insert(inventoryMovements).values({ itemId: gasket!.id, movementType: "receive", quantity: "500", lotNumber: "MF-LOT-20", referenceType: "receiving", referenceId: String(doc!.id), performedBy, performedAt: daysAgo(20) });
    const cleanOpts = { department: "quality", isAdminOrPlatformAdmin: true, performedBy };
    await transitionReceivingLineItem(tdb, line!.id, "pending_inspection", cleanOpts);
    await transitionReceivingLineItem(tdb, line!.id, "inspected", cleanOpts);
    await transitionReceivingLineItem(tdb, line!.id, "accepted", cleanOpts);
  }

  await tdb.insert(inventoryStock).values({ itemId: bracket!.id, onHand: "530", lastAdjustedAt: daysAgo(10), lastAdjustedBy: performedBy });
  await tdb.insert(inventoryStock).values({ itemId: gasket!.id, onHand: "500", lastAdjustedAt: daysAgo(20), lastAdjustedBy: performedBy });

  // ---------------------------------------------------------------------
  // NCR — created directly (autoCreateNcrOnQuarantine is off by default and
  // this script deliberately doesn't flip it — see file header), then walked
  // through its REAL lifecycle for a real audit trail + form sync.
  // ---------------------------------------------------------------------
  const [demoNcr] = await tdb
    .insert(ncr)
    .values({
      title: "Bracket dimensional out-of-spec — Titan Components lot TC-LOT-75",
      description: "Mounting holes on Titan Bracket Assembly 4400 measured outside drawing tolerance (+0.015in). Lot quarantined pending disposition.",
      severity: "high",
      supplierId: titan!.id,
      receivingLineItemId: firstQuarantinedLineId ?? undefined,
      createdBy: performedBy,
      createdAt: daysAgo(75),
    })
    .returning();
  await recordAuditTrail(tdb, { entityType: "NCR", entityId: demoNcr!.id, action: "create", changes: { message: "Demo story seed" }, performedBy });

  await setContainment(tdb, demoNcr!.id, "Lot TC-LOT-75 quarantined in receiving inspection cage; production notified to hold any in-process assemblies using this lot.", performedBy);
  await setRootCause(tdb, demoNcr!.id, "Supplier's stamping die (Die #7) has worn beyond tolerance, producing mounting holes 0.010-0.015in oversized. Confirmed via Titan's own CMM report submitted with their 8D response.", performedBy);
  await setCorrectiveAction(tdb, demoNcr!.id, "Titan Components to replace Die #7 and requalify with a 30-piece first-article inspection before resuming shipment. AccuQual to increase incoming inspection sample size to 100% for the next 3 lots.", performedBy);
  await closeNcr(tdb, tenantId, demoNcr!.id, performedBy);

  // ---------------------------------------------------------------------
  // CAPA — let the real receiving automation's escalation stand if it
  // fired; otherwise (e.g. this tenant's thresholds were customized) fall
  // back to a direct insert so the demo story still completes.
  // ---------------------------------------------------------------------
  let [demoCapa] = await tdb.select().from(capa).where(and(eq(capa.supplierId, titan!.id), eq(capa.escalationSource, "receiving_recurrence")));
  if (!demoCapa) {
    [demoCapa] = await tdb
      .insert(capa)
      .values({ ncrId: demoNcr!.id, rootCause: "Recurring receiving quarantines/rejections from Titan Components — 3 qualifying events in the last 90 days.", status: "open", escalationSource: "receiving_recurrence", supplierId: titan!.id, createdAt: daysAgo(10) })
      .returning();
    await recordAuditTrail(tdb, { entityType: "CAPA", entityId: demoCapa!.id, action: "create", changes: { message: "Demo story seed (fallback — automation didn't fire)" }, performedBy });
  }
  await tdb.update(capa).set({ ncrId: demoCapa!.ncrId ?? demoNcr!.id, actionPlan: "Supplier corrective action: replace worn stamping die and requalify. Internal: raise incoming inspection to 100% for 3 lots.", ownerId: performedBy, status: "in_progress" }).where(eq(capa.id, demoCapa!.id));
  await recordAuditTrail(tdb, { entityType: "CAPA", entityId: demoCapa!.id, action: "status_change", changes: { action: "in_progress" }, performedBy });
  await tdb.update(capa).set({ verification: "First-article inspection of Die #7's requalification run (30 pcs) passed with zero dimensional nonconformances.", status: "verifying", verifiedBy: performedBy, verifiedAt: daysAgo(3) }).where(eq(capa.id, demoCapa!.id));
  await recordAuditTrail(tdb, { entityType: "CAPA", entityId: demoCapa!.id, action: "status_change", changes: { action: "verify" }, performedBy });
  await tdb.update(capa).set({ status: "closed", closedAt: daysAgo(1) }).where(eq(capa.id, demoCapa!.id));
  await recordAuditTrail(tdb, { entityType: "CAPA", entityId: demoCapa!.id, action: "status_change", changes: { action: "close" }, performedBy });

  // ---------------------------------------------------------------------
  // 8D — internal working record + Titan's own submitted response.
  // ---------------------------------------------------------------------
  const [demo8d] = await tdb
    .insert(eightD)
    .values({
      ncrId: demoNcr!.id,
      currentStep: 8,
      data: {
        d1_team: "Quality Engineering (lead), Purchasing, Titan Components Quality Manager",
        d2_problem: "Bracket 4400 mounting holes measuring 0.010-0.015in oversized across 3 receiving lots from Titan Components.",
        d3_containment: "Lots quarantined on arrival; production held on affected lot numbers.",
        d4_rootCause: "Stamping Die #7 worn beyond tolerance.",
        d5_correctiveAction: "Replace Die #7; requalify with 30-piece first-article inspection.",
        d6_implementation: "Die replaced and requalified; 100% incoming inspection for next 3 lots.",
        d7_prevention: "Titan added die-wear PM interval to their maintenance schedule; AccuQual added dimensional CoC requirement to the PO.",
        d8_closure: "CAPA verified effective and closed; incoming inspection reverted to standard sampling after 3 clean lots.",
      },
      createdAt: daysAgo(70),
    })
    .returning();

  await tdb.insert(supplier8dResponses).values({
    supplierId: titan!.id,
    linkedNcrId: demoNcr!.id,
    linkedEightDId: demo8d!.id,
    status: "accepted",
    data: {
      d1_team: "Titan Components Quality Manager, Die Shop Lead",
      d2_problem: "Mounting hole diameter drifted out of spec on Die #7 output.",
      d3_containment: "Sorted remaining WIP; halted shipment from affected run.",
      d4_rootCause: "Die #7 punch wear exceeded PM interval.",
      d5_correctiveAction: "Die #7 replaced with rebuilt tooling.",
      d6_validation: "30-piece first-article CMM report attached — all within tolerance.",
      d7_prevention: "Die wear added to preventive maintenance schedule at 75% of prior interval.",
      d8_closure: "Customer (AccuQual) verification passed; case closed.",
    },
    reviewNotes: "First-article CMM data reviewed and accepted. Corrective action verified effective.",
    reviewedByUserId: performedBy,
    submittedByUserId: performedBy,
    createdAt: daysAgo(55),
  });

  // ---------------------------------------------------------------------
  // Warranty claim — a customer's field failure traced back to the same
  // defective lot, walked through its real lifecycle.
  // ---------------------------------------------------------------------
  const [customer] = await tdb
    .insert(customers)
    .values({ legalName: "Northfield Industries", primaryContactName: "Dana Ruiz", primaryContactEmail: "dana.ruiz@northfield.example", customerType: "OEM", status: "activated" })
    .returning();

  const [claimDraft] = await tdb
    .insert(warrantyClaims)
    .values({
      claimNumber: "WC-PENDING",
      status: "new",
      customerId: customer!.id,
      productId: bracket!.id,
      serialNumber: "SN-88214",
      purchaseDate: daysAgo(60),
      failureDate: daysAgo(20),
      failureDescription: "Bracket cracked at mounting point after ~2 weeks in service.",
      warrantyCostEstimate: "450.00",
      supplierId: titan!.id,
      linkedNcrId: demoNcr!.id,
      createdByUserId: performedBy,
      createdAt: daysAgo(20),
    })
    .returning();
  const claimNumber = `WC-${String(claimDraft!.id).padStart(6, "0")}`;
  const [claim] = await tdb.update(warrantyClaims).set({ claimNumber }).where(eq(warrantyClaims.id, claimDraft!.id)).returning();
  await tdb.insert(warrantyClaimWorkflow).values({ claimId: claim!.id, fromStatus: null, toStatus: "new", performedByUserId: performedBy, createdAt: daysAgo(20) });
  await recordAuditTrail(tdb, { entityType: "WarrantyClaim", entityId: claim!.id, action: "create", changes: { message: "Demo story seed" }, performedBy });

  async function transitionWarranty(toStatus: string, note: string, when: Date) {
    const [current] = await tdb.select().from(warrantyClaims).where(eq(warrantyClaims.id, claim!.id));
    await tdb.update(warrantyClaims).set({ status: toStatus, updatedAt: when }).where(eq(warrantyClaims.id, claim!.id));
    await tdb.insert(warrantyClaimWorkflow).values({ claimId: claim!.id, fromStatus: current!.status, toStatus, note, performedByUserId: performedBy, createdAt: when });
    await recordAuditTrail(tdb, { entityType: "WarrantyClaim", entityId: claim!.id, action: "status_change", changes: { oldStatus: current!.status, newStatus: toStatus, note }, performedBy });
  }
  await transitionWarranty("inspection", "Failed bracket received and logged for inspection.", daysAgo(18));
  await tdb.update(warrantyClaims).set({ inspectionNotes: "Fracture surface consistent with an oversized mounting hole causing stress concentration — matches the Die #7 defect.", inspectedByUserId: performedBy, inspectionDate: daysAgo(16) }).where(eq(warrantyClaims.id, claim!.id));
  await transitionWarranty("supplier_review", "Forwarded to Titan Components for review alongside open CAPA.", daysAgo(15));
  await tdb.update(warrantyClaims).set({ supplierReviewNotes: "Titan Components confirmed the fracture matches the known Die #7 defect and accepted the claim." }).where(eq(warrantyClaims.id, claim!.id));
  await transitionWarranty("approved", "Approved — confirmed root cause matches the open Titan Components CAPA.", daysAgo(12));
  await transitionWarranty("replaced", "Replacement unit shipped to customer.", daysAgo(8));
  await tdb.update(warrantyClaims).set({ dispositionNotes: "Replacement shipped under warranty; cost billed back to Titan Components per supplier agreement." }).where(eq(warrantyClaims.id, claim!.id));
  await transitionWarranty("closed", "Customer confirmed replacement resolved the issue.", daysAgo(5));

  await tdb.insert(warrantyClaimCosts).values({ claimId: claim!.id, costType: "replacement_unit", amount: "340.00", notes: "Replacement bracket assembly", recordedByUserId: performedBy, createdAt: daysAgo(8) });
  await tdb.insert(warrantyClaimCosts).values({ claimId: claim!.id, costType: "labor", amount: "120.00", notes: "Field technician swap labor", recordedByUserId: performedBy, createdAt: daysAgo(8) });
  await tdb.update(warrantyClaims).set({ warrantyActualCost: "460.00" }).where(eq(warrantyClaims.id, claim!.id));

  // ---------------------------------------------------------------------
  // RMA Log — the customer-return register entry tying the warranty claim
  // and the NCR together.
  // ---------------------------------------------------------------------
  const [rmaDraft] = await tdb
    .insert(rmaLogRecords)
    .values({
      status: "open",
      rmaNumber: "RMA-PENDING",
      dateIssued: daysAgo(19),
      customerName: "Northfield Industries",
      partNumber: "TC-4400-BRKT",
      partDescription: "Titan Bracket Assembly 4400",
      quantityReturned: "1",
      serialNumber: "SN-88214",
      customerReasonForReturn: "Bracket cracked at mounting point in service.",
      warrantyId: claim!.id,
      qualityId: demoNcr!.id,
      createdByUserId: performedBy,
      createdAt: daysAgo(19),
    })
    .returning();
  const rmaNumber = `RMA-${new Date().getFullYear()}-${String(rmaDraft!.id).padStart(4, "0")}`;
  await tdb.update(rmaLogRecords).set({ rmaNumber }).where(eq(rmaLogRecords.id, rmaDraft!.id));
  await recordAuditTrail(tdb, { entityType: "RmaLog", entityId: rmaDraft!.id, action: "create", changes: { message: "Demo story seed" }, performedBy });

  async function transitionRma(toStatus: string, extra: Record<string, unknown> = {}) {
    const [current] = await tdb.select().from(rmaLogRecords).where(eq(rmaLogRecords.id, rmaDraft!.id));
    const patch: Record<string, unknown> = { status: toStatus, updatedAt: new Date(), ...extra };
    if (toStatus === "received" && !current!.dateReceived) patch.dateReceived = daysAgo(17);
    if (toStatus === "closed" && !current!.dateClosed) patch.dateClosed = daysAgo(4);
    await tdb.update(rmaLogRecords).set(patch).where(eq(rmaLogRecords.id, rmaDraft!.id));
    await recordAuditTrail(tdb, { entityType: "RmaLog", entityId: rmaDraft!.id, action: "status_change", changes: { oldStatus: current!.status, newStatus: toStatus }, performedBy });
  }
  await transitionRma("received");
  await transitionRma("under_review", { qualityTeamFindings: "Confirmed dimensional defect matching NCR — root cause traced to Titan Components Die #7." });
  await transitionRma("dispositioned", { dispositionAction: "Replace", correctiveAction: "Replacement issued under warranty; cost recovered from supplier." });
  await transitionRma("closed", { creditMemo: "N/A — replacement issued, no credit memo required." });

  // ---------------------------------------------------------------------
  // Audit — an internal supplier-quality audit citing the same issue.
  // ---------------------------------------------------------------------
  const [demoAudit] = await tdb
    .insert(audits)
    .values({ name: "Q3 Supplier Quality Audit — Titan Components", type: "supplier", auditorId: performedBy, status: "completed", scheduledAt: daysAgo(50), completedAt: daysAgo(45) })
    .returning();
  await tdb.insert(auditItems).values([
    {
      auditId: demoAudit!.id,
      question: "Does the supplier's process control plan address known wear items on tooling?",
      finding: "Die #7's wear was not on a preventive maintenance schedule at the time of the Q3 incident — added post-CAPA.",
      severity: "major",
      evidence: `Referenced NCR #${demoNcr!.id}, CAPA #${demoCapa!.id}.`,
    },
    {
      auditId: demoAudit!.id,
      question: "Are first-article inspection records retained for tooling requalification?",
      finding: "First-article CMM report for the Die #7 rebuild was on file and complete.",
      severity: "observation",
    },
  ]);

  // ---------------------------------------------------------------------
  // Real, computed supplier quality risk scores — not hand-picked numbers.
  // ---------------------------------------------------------------------
  const titanScore = await recomputeSupplierRiskScore(tdb, titan!.id, performedBy);
  const meridianScore = await recomputeSupplierRiskScore(tdb, meridian!.id, performedBy);

  // ---------------------------------------------------------------------
  // Workflow Inbox demo data — a handful of currently-OPEN items assigned
  // to/owned by the admin user, so the new per-user Workflow Inbox/Calendar
  // feature (GET /calendar) has real, non-empty data to show out of the
  // box. Additive only — everything above this block is the original demo
  // story and is untouched; none of these rows are ever closed/completed.
  // ---------------------------------------------------------------------
  const [inboxNcr] = await tdb
    .insert(ncr)
    .values({
      title: "Gasket seal leak reported on Meridian Fasteners lot MF-LOT-20",
      description: "Field report of a minor seal leak; awaiting containment review.",
      severity: "medium",
      supplierId: meridian!.id,
      assignedTo: performedBy,
      createdBy: performedBy,
      createdAt: daysAgo(2),
    })
    .returning();
  await recordAuditTrail(tdb, { entityType: "NCR", entityId: inboxNcr!.id, action: "create", changes: { message: "Demo story seed (Workflow Inbox)" }, performedBy });

  const [inboxCapa] = await tdb
    .insert(capa)
    .values({ ncrId: inboxNcr!.id, rootCause: "Under investigation.", status: "in_progress", ownerId: performedBy, supplierId: meridian!.id, createdAt: daysAgo(1) })
    .returning();
  await recordAuditTrail(tdb, { entityType: "CAPA", entityId: inboxCapa!.id, action: "create", changes: { message: "Demo story seed (Workflow Inbox)" }, performedBy });

  await tdb.insert(audits).values({ name: "Q4 Internal Process Audit — Receiving", type: "internal", auditorId: performedBy, status: "scheduled", scheduledAt: daysAgo(-14) });

  const [inboxCourse] = await tdb.insert(trainingCourses).values({ title: "Annual Quality System Refresher" }).returning();
  await tdb.insert(trainingAssignments).values({ courseId: inboxCourse!.id, userId: performedBy!, status: "assigned", dueAt: daysAgo(5), assignedBy: performedBy });

  await tdb.insert(documents).values({ title: "SOP-114 Incoming Inspection (Rev C)", category: "SOP", status: "in_review", ownerId: performedBy, createdAt: daysAgo(3) });

  logger.info("Demo story seed complete.");
  logger.info(`  Supplier "${DEMO_SUPPLIER_NAME}" (id ${titan!.id}): risk score ${titanScore.score} (${titanScore.band})`);
  logger.info(`  Supplier "${HEALTHY_SUPPLIER_NAME}" (id ${meridian!.id}): risk score ${meridianScore.score} (${meridianScore.band})`);
  logger.info(`  NCR #${demoNcr!.id}, CAPA #${demoCapa!.id}, 8D #${demo8d!.id}, Warranty ${claimNumber}, RMA ${rmaNumber}, Audit #${demoAudit!.id}`);
  await closeEventBusClient();
  await pool.end();
}

main().catch((err) => {
  logger.error("Demo story seed failed", err);
  process.exit(1);
});
