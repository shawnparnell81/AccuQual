import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { db, pool } from "./index.js";
import { logger } from "../utils/logger.js";
import { company } from "../drizzle/schema/company.js";
import { suppliers, supplierScorecards } from "../drizzle/schema/supplier.js";
import { inventoryItems, inventoryStock, inventoryMovements } from "../drizzle/schema/inventory.js";
import { inventoryLots } from "../drizzle/schema/inventoryLots.js";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems } from "../drizzle/schema/erp.js";
import { ncr } from "../drizzle/schema/ncr.js";
import { capa } from "../drizzle/schema/capa.js";
import { eightD } from "../drizzle/schema/eightD.js";
import { supplier8dResponses } from "../drizzle/schema/supplierPortal.js";
import { customers } from "../drizzle/schema/customers.js";
import { warrantyClaims, warrantyClaimCosts, warrantyClaimWorkflow } from "../drizzle/schema/warranty.js";
import { rmaLogRecords } from "../drizzle/schema/rmaLog.js";
import { audits, auditItems } from "../drizzle/schema/audits.js";
import { supplierQualityRiskScores } from "../drizzle/schema/supplierQualityRisk.js";
import { auditTrail } from "../drizzle/schema/auditTrail.js";
import { customerScorecards } from "../drizzle/schema/customerScorecards.js";
import { trainingAssignments, trainingCourses } from "../drizzle/schema/training.js";
import { documents } from "../drizzle/schema/documents.js";

const DEMO_SUPPLIER_NAME = "Titan Components Inc.";
const HEALTHY_SUPPLIER_NAME = "Meridian Fasteners LLC";
const DEMO_CUSTOMER_NAME = "Northfield Industries";

/**
 * Phase 11 task 13 — "backend support for resetting demo data." Deletes
 * exactly the rows seedDemoStory.ts creates (identified by the two
 * recognizable supplier names it seeds, walked outward through their real
 * FK relationships, children before parents) and nothing else — never
 * touches the tenant's own structural rows (users, roles, form templates)
 * or anything a real user added. Re-run `npm run db:seed-demo-story`
 * afterward to seed fresh. Not exposed as an in-app button deliberately —
 * a live "wipe tenant data" control is a real destructive-action risk this
 * script avoids by staying a deliberate, explicit CLI step.
 */
async function main() {
  logger.info("Resetting demo story data...");

  const [tenant] = await db.select().from(company).where(eq(company.code, "demo"));
  if (!tenant) {
    logger.info("No demo tenant found — nothing to reset.");
    await pool.end();
    return;
  }

  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(inArray(suppliers.name, [DEMO_SUPPLIER_NAME, HEALTHY_SUPPLIER_NAME])));
  const supplierIds = supplierRows.map((s) => s.id);
  if (supplierIds.length === 0) {
    logger.info("No demo story data found — nothing to reset.");
    await pool.end();
    return;
  }

  const itemRows = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(inArray(inventoryItems.defaultSupplierId, supplierIds)));
  const itemIds = itemRows.map((i) => i.id);

  const poRows = await db.select({ id: erpPurchaseOrders.id }).from(erpPurchaseOrders).where(and(inArray(erpPurchaseOrders.supplierId, supplierIds)));
  const poIds = poRows.map((p) => p.id);
  const poLineRows = poIds.length ? await db.select({ id: erpPoLineItems.id }).from(erpPoLineItems).where(inArray(erpPoLineItems.purchaseOrderId, poIds)) : [];
  const poLineIds = poLineRows.map((l) => l.id);
  const docRows = poIds.length ? await db.select({ id: erpReceivingDocuments.id }).from(erpReceivingDocuments).where(inArray(erpReceivingDocuments.purchaseOrderId, poIds)) : [];
  const docIds = docRows.map((d) => d.id);
  const lineRows = poLineIds.length ? await db.select({ id: erpReceivingLineItems.id }).from(erpReceivingLineItems).where(inArray(erpReceivingLineItems.poLineItemId, poLineIds)) : [];
  const lineIds = lineRows.map((l) => l.id);

  const ncrRows = await db.select({ id: ncr.id }).from(ncr).where(and(inArray(ncr.supplierId, supplierIds)));
  const ncrIds = ncrRows.map((n) => n.id);
  const capaRows = await db.select({ id: capa.id }).from(capa).where(and(inArray(capa.supplierId, supplierIds)));
  const capaIds = capaRows.map((c) => c.id);
  const eightDRows = ncrIds.length ? await db.select({ id: eightD.id }).from(eightD).where(inArray(eightD.ncrId, ncrIds)) : [];
  const eightDIds = eightDRows.map((e) => e.id);

  const customerRows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.legalName, DEMO_CUSTOMER_NAME)));
  const customerIds = customerRows.map((c) => c.id);
  const claimRows = customerIds.length ? await db.select({ id: warrantyClaims.id }).from(warrantyClaims).where(inArray(warrantyClaims.customerId, customerIds)) : [];
  const claimIds = claimRows.map((c) => c.id);

  const auditRows = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(inArray(audits.name, ["Q3 Supplier Quality Audit — Titan Components", "Q4 Internal Process Audit — Receiving"])));
  const auditIds = auditRows.map((a) => a.id);

  // Workflow Inbox demo data (seedDemoStory.ts's additive block) — not
  // reachable via the supplier/customer walk above, so found by the same
  // recognizable names it seeds.
  const courseRows = await db.select({ id: trainingCourses.id }).from(trainingCourses).where(and(eq(trainingCourses.title, "Annual Quality System Refresher")));
  const courseIds = courseRows.map((c) => c.id);
  const documentRows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.title, "SOP-114 Incoming Inspection (Rev C)")));
  const documentIds = documentRows.map((d) => d.id);

  // Wrapped in one transaction — a mid-sequence failure (e.g. a later
  // schema addition, like customer_scorecards, that references a table
  // deleted here and was never taught to this script) rolls back cleanly
  // instead of leaving the demo tenant in a half-deleted state.
  await db.transaction(async (tx) => {
    // Children first, in FK dependency order.
    if (auditIds.length) await tx.delete(auditItems).where(inArray(auditItems.auditId, auditIds));
    if (auditIds.length) await tx.delete(audits).where(inArray(audits.id, auditIds));

    if (claimIds.length) {
      await tx.delete(warrantyClaimCosts).where(inArray(warrantyClaimCosts.claimId, claimIds));
      await tx.delete(warrantyClaimWorkflow).where(inArray(warrantyClaimWorkflow.claimId, claimIds));
    }
    await tx.delete(rmaLogRecords).where(and(inArray(rmaLogRecords.qualityId, ncrIds.length ? ncrIds : [-1])));
    if (claimIds.length) await tx.delete(warrantyClaims).where(inArray(warrantyClaims.id, claimIds));
    if (customerIds.length) await tx.delete(customerScorecards).where(inArray(customerScorecards.customerId, customerIds));
    if (customerIds.length) await tx.delete(customers).where(inArray(customers.id, customerIds));

    if (eightDIds.length) await tx.delete(supplier8dResponses).where(inArray(supplier8dResponses.linkedEightDId, eightDIds));
    if (eightDIds.length) await tx.delete(eightD).where(inArray(eightD.id, eightDIds));
    if (capaIds.length) await tx.delete(capa).where(inArray(capa.id, capaIds));
    if (ncrIds.length) await tx.delete(ncr).where(inArray(ncr.id, ncrIds));

    if (courseIds.length) await tx.delete(trainingAssignments).where(inArray(trainingAssignments.courseId, courseIds));
    if (courseIds.length) await tx.delete(trainingCourses).where(inArray(trainingCourses.id, courseIds));
    if (documentIds.length) await tx.delete(documents).where(inArray(documents.id, documentIds));

    if (itemIds.length) await tx.delete(inventoryLots).where(inArray(inventoryLots.itemId, itemIds));
    if (itemIds.length) await tx.delete(inventoryMovements).where(inArray(inventoryMovements.itemId, itemIds));
    if (itemIds.length) await tx.delete(inventoryStock).where(inArray(inventoryStock.itemId, itemIds));
    if (lineIds.length) await tx.delete(erpReceivingLineItems).where(inArray(erpReceivingLineItems.id, lineIds));
    if (docIds.length) await tx.delete(erpReceivingDocuments).where(inArray(erpReceivingDocuments.id, docIds));
    if (poLineIds.length) await tx.delete(erpPoLineItems).where(inArray(erpPoLineItems.id, poLineIds));
    if (poIds.length) await tx.delete(erpPurchaseOrders).where(inArray(erpPurchaseOrders.id, poIds));
    if (itemIds.length) await tx.delete(inventoryItems).where(inArray(inventoryItems.id, itemIds));

    await tx.delete(supplierQualityRiskScores).where(inArray(supplierQualityRiskScores.supplierId, supplierIds));
    await tx.delete(supplierScorecards).where(inArray(supplierScorecards.supplierId, supplierIds));
    await tx.delete(suppliers).where(inArray(suppliers.id, supplierIds));

    // Audit trail rows the seed's own recordAuditTrail() calls wrote — tidy up
    // so a re-seed doesn't leave orphaned history entries pointing at deleted ids.
    if (ncrIds.length) await tx.delete(auditTrail).where(and(eq(auditTrail.entityType, "NCR"), inArray(auditTrail.entityId, ncrIds)));
    if (capaIds.length) await tx.delete(auditTrail).where(and(eq(auditTrail.entityType, "CAPA"), inArray(auditTrail.entityId, capaIds)));
    if (claimIds.length) await tx.delete(auditTrail).where(and(eq(auditTrail.entityType, "WarrantyClaim"), inArray(auditTrail.entityId, claimIds)));
  });

  logger.info(`Demo story reset complete — removed ${supplierIds.length} supplier(s), ${ncrIds.length} NCR(s), ${capaIds.length} CAPA(s), ${claimIds.length} warranty claim(s), ${auditIds.length} audit(s).`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Demo story reset failed", err);
  process.exit(1);
});
