import { and, eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { rma } from "../../drizzle/schema/rma.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { supplierCorrectiveActions, supplier8dResponses } from "../../drizzle/schema/supplierPortal.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";

/**
 * The one real derivation of "which NCRs/CAPAs belong to this supplier" —
 * factored out of supplierPortal.controller.ts's own
 * supplierNcrListHandler/supplierCapaListHandler (which now just call these)
 * so Phase 7's Supplier Quality Risk Score (supplier.qualityRisk.ts) and any
 * other future consumer never re-derive this join differently. Originally
 * NCR/CAPA had no supplierId column of their own, so this only unioned
 * indirect links (an RMA/warranty claim raised against them, or a
 * corrective-action/8D response they themselves submitted). Phase 8 added a
 * real, direct `ncr.supplierId` (set automatically when an NCR is
 * auto-created from a rejected/quarantined receiving inspection — see
 * erp/receivingAutomation.ts) — included here too, or a supplier-triggered
 * receiving NCR would be invisible in their own Supplier Portal.
 */
export async function getSupplierNcrIds(db: TenantDb, supplierId: number): Promise<number[]> {
  const [rmaRows, warrantyRows, carRows, eightDRows, directRows] = await Promise.all([
    db.select({ ncrId: rma.linkedNcrId }).from(rma).where(and(eq(rma.supplierId, supplierId))),
    db.select({ ncrId: warrantyClaims.linkedNcrId }).from(warrantyClaims).where(and(eq(warrantyClaims.supplierId, supplierId))),
    db.select({ ncrId: supplierCorrectiveActions.linkedNcrId }).from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.supplierId, supplierId))),
    db.select({ ncrId: supplier8dResponses.linkedNcrId }).from(supplier8dResponses).where(and(eq(supplier8dResponses.supplierId, supplierId))),
    db.select({ ncrId: ncr.id }).from(ncr).where(and(eq(ncr.supplierId, supplierId), eq(ncr.isDeleted, false))),
  ]);
  return [...new Set([...rmaRows, ...warrantyRows, ...carRows, ...eightDRows, ...directRows].map((r) => r.ncrId).filter((id): id is number => id !== null))];
}

/** Phase 8 adds direct `capa.supplierId` (set by receivingAutomation.ts's checkCapaEscalation) — same reasoning as getSupplierNcrIds above. */
export async function getSupplierCapaIds(db: TenantDb, supplierId: number): Promise<number[]> {
  const [rmaRows, carRows, directRows] = await Promise.all([
    db.select({ capaId: rma.linkedCapaId }).from(rma).where(and(eq(rma.supplierId, supplierId))),
    db.select({ capaId: supplierCorrectiveActions.linkedCapaId }).from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.supplierId, supplierId))),
    db.select({ capaId: capa.id }).from(capa).where(and(eq(capa.supplierId, supplierId))),
  ]);
  return [...new Set([...rmaRows, ...carRows, ...directRows].map((r) => r.capaId).filter((id): id is number => id !== null))];
}
