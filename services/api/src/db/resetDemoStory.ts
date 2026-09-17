import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { db, pool } from "./index.js";
import { logger } from "../utils/logger.js";
import { tenants } from "../drizzle/schema/tenants.js";
import { suppliers } from "../drizzle/schema/supplier.js";
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

  const [tenant] = await db.select().from(tenants).where(eq(tenants.code, "demo"));
  if (!tenant) {
    logger.info("No demo tenant found — nothing to reset.");
    await pool.end();
    return;
  }
  const tenantId = tenant.id;

  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.name, [DEMO_SUPPLIER_NAME, HEALTHY_SUPPLIER_NAME])));
  const supplierIds = supplierRows.map((s) => s.id);
  if (supplierIds.length === 0) {
    logger.info("No demo story data found — nothing to reset.");
    await pool.end();
    return;
  }

  const itemRows = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.defaultSupplierId, supplierIds)));
  const itemIds = itemRows.map((i) => i.id);

  const poRows = await db.select({ id: erpPurchaseOrders.id }).from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.tenantId, tenantId), inArray(erpPurchaseOrders.supplierId, supplierIds)));
  const poIds = poRows.map((p) => p.id);
  const poLineRows = poIds.length ? await db.select({ id: erpPoLineItems.id }).from(erpPoLineItems).where(inArray(erpPoLineItems.purchaseOrderId, poIds)) : [];
  const poLineIds = poLineRows.map((l) => l.id);
  const docRows = poIds.length ? await db.select({ id: erpReceivingDocuments.id }).from(erpReceivingDocuments).where(inArray(erpReceivingDocuments.purchaseOrderId, poIds)) : [];
  const docIds = docRows.map((d) => d.id);
  const lineRows = poLineIds.length ? await db.select({ id: erpReceivingLineItems.id }).from(erpReceivingLineItems).where(inArray(erpReceivingLineItems.poLineItemId, poLineIds)) : [];
  const lineIds = lineRows.map((l) => l.id);

  const ncrRows = await db.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.tenantId, tenantId), inArray(ncr.supplierId, supplierIds)));
  const ncrIds = ncrRows.map((n) => n.id);
  const capaRows = await db.select({ id: capa.id }).from(capa).where(and(eq(capa.tenantId, tenantId), inArray(capa.supplierId, supplierIds)));
  const capaIds = capaRows.map((c) => c.id);
  const eightDRows = ncrIds.length ? await db.select({ id: eightD.id }).from(eightD).where(inArray(eightD.ncrId, ncrIds)) : [];
  const eightDIds = eightDRows.map((e) => e.id);

  const customerRows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.legalName, DEMO_CUSTOMER_NAME)));
  const customerIds = customerRows.map((c) => c.id);
  const claimRows = customerIds.length ? await db.select({ id: warrantyClaims.id }).from(warrantyClaims).where(inArray(warrantyClaims.customerId, customerIds)) : [];
  const claimIds = claimRows.map((c) => c.id);

  const auditRows = await db.select({ id: audits.id }).from(audits).where(and(eq(audits.tenantId, tenantId), eq(audits.name, "Q3 Supplier Quality Audit — Titan Components")));
  const auditIds = auditRows.map((a) => a.id);

  // Children first, in FK dependency order.
  if (auditIds.length) await db.delete(auditItems).where(inArray(auditItems.auditId, auditIds));
  if (auditIds.length) await db.delete(audits).where(inArray(audits.id, auditIds));

  if (claimIds.length) {
    await db.delete(warrantyClaimCosts).where(inArray(warrantyClaimCosts.claimId, claimIds));
    await db.delete(warrantyClaimWorkflow).where(inArray(warrantyClaimWorkflow.claimId, claimIds));
  }
  await db.delete(rmaLogRecords).where(and(eq(rmaLogRecords.tenantId, tenantId), inArray(rmaLogRecords.qualityId, ncrIds.length ? ncrIds : [-1])));
  if (claimIds.length) await db.delete(warrantyClaims).where(inArray(warrantyClaims.id, claimIds));
  if (customerIds.length) await db.delete(customers).where(inArray(customers.id, customerIds));

  if (eightDIds.length) await db.delete(supplier8dResponses).where(inArray(supplier8dResponses.linkedEightDId, eightDIds));
  if (eightDIds.length) await db.delete(eightD).where(inArray(eightD.id, eightDIds));
  if (capaIds.length) await db.delete(capa).where(inArray(capa.id, capaIds));
  if (ncrIds.length) await db.delete(ncr).where(inArray(ncr.id, ncrIds));

  if (itemIds.length) await db.delete(inventoryLots).where(inArray(inventoryLots.itemId, itemIds));
  if (itemIds.length) await db.delete(inventoryMovements).where(inArray(inventoryMovements.itemId, itemIds));
  if (itemIds.length) await db.delete(inventoryStock).where(inArray(inventoryStock.itemId, itemIds));
  if (lineIds.length) await db.delete(erpReceivingLineItems).where(inArray(erpReceivingLineItems.id, lineIds));
  if (docIds.length) await db.delete(erpReceivingDocuments).where(inArray(erpReceivingDocuments.id, docIds));
  if (poLineIds.length) await db.delete(erpPoLineItems).where(inArray(erpPoLineItems.id, poLineIds));
  if (poIds.length) await db.delete(erpPurchaseOrders).where(inArray(erpPurchaseOrders.id, poIds));
  if (itemIds.length) await db.delete(inventoryItems).where(inArray(inventoryItems.id, itemIds));

  await db.delete(supplierQualityRiskScores).where(inArray(supplierQualityRiskScores.supplierId, supplierIds));
  await db.delete(suppliers).where(inArray(suppliers.id, supplierIds));

  // Audit trail rows the seed's own recordAuditTrail() calls wrote — tidy up
  // so a re-seed doesn't leave orphaned history entries pointing at deleted ids.
  if (ncrIds.length) await db.delete(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "NCR"), inArray(auditTrail.entityId, ncrIds)));
  if (capaIds.length) await db.delete(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "CAPA"), inArray(auditTrail.entityId, capaIds)));
  if (claimIds.length) await db.delete(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "WarrantyClaim"), inArray(auditTrail.entityId, claimIds)));

  logger.info(`Demo story reset complete — removed ${supplierIds.length} supplier(s), ${ncrIds.length} NCR(s), ${capaIds.length} CAPA(s), ${claimIds.length} warranty claim(s), ${auditIds.length} audit(s).`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Demo story reset failed", err);
  process.exit(1);
});
