import type { Request, Response } from "express";
import { and, eq, sql, ilike, type SQLWrapper } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { erpPurchaseOrders } from "../../drizzle/schema/erp.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { audits } from "../../drizzle/schema/audits.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { rma } from "../../drizzle/schema/rma.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { Db } from "../../lib/requestDb.js";

const RESULTS_PER_TYPE = 5;

export interface SearchResult {
  type: "NCR" | "CAPA" | "PO" | "WO" | "Audit" | "Supplier" | "Item" | "Training" | "Calibration" | "RMA" | "8D" | "Complaint" | "Change" | "Risk" | "PPAP";
  id: number;
  label: string;
  path: string;
}

/**
 * Same real per-department/role access already enforced on each module's
 * own routes (see departmentAccess.ts's getUserAccessLevel — this is a live
 * DB-driven check now, same as requireDepartmentAccess itself, not a
 * hardcoded-matrix lookup) — a category this user has no read access to on
 * the real module is simply never searched, not filtered out after the
 * fact. Training has no ResourceKey at all (see DEFAULT_PERMISSION_MATRIX's
 * own comment: read-by-everyone) — always searchable.
 */
async function canRead(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  resourceKey: ResourceKey
): Promise<boolean> {
  const level = await getUserAccessLevel(db, user, resourceKey);
  return level !== "none";
}

/** "12" matches ids 12, 120, 123, ... — a prefix match on the id cast to text, never on any title/description column, per "search ONLY by document number or ID". */
function idPrefix(column: SQLWrapper, digits: string) {
  return sql`CAST(${column} AS TEXT) LIKE ${digits + "%"}`;
}

/**
 * GET /search?q=... — read-only across every module's own real table, no
 * new table of its own. Covers NCR/CAPA/PO/Work Order/Audit/Supplier/
 * Item/Training/Calibration/RMA/8D/Complaint/Change/Risk/PPAP.
 */
export const searchHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as Db;
  const user = { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
  const q = String(req.query.q ?? "").trim();

  if (!q) return res.json({ results: [] });

  const digits = /^\d+$/.test(q) ? q : null;
  const results: SearchResult[] = [];

  if (digits && await canRead(db, user, "ncr")) {
    const rows = await db.select().from(ncr).where(and(eq(ncr.siteId, req.siteId ?? -1), idPrefix(ncr.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "NCR", id: r.id, label: `NCR #${r.id} — ${r.title}`, path: `/ncr/${r.id}` });
  }

  if (digits && await canRead(db, user, "capa")) {
    const rows = await db.select().from(capa).where(and(eq(capa.siteId, req.siteId ?? -1), idPrefix(capa.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "CAPA", id: r.id, label: `CAPA #${r.id}${r.ncrId ? ` (NCR #${r.ncrId})` : ""}`, path: `/capa/${r.id}` });
  }

  if (digits && await canRead(db, user, "erp")) {
    const rows = await db
      .select({ id: erpPurchaseOrders.id, status: erpPurchaseOrders.status, supplierName: suppliers.name })
      .from(erpPurchaseOrders)
      .leftJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
      .where(and(idPrefix(erpPurchaseOrders.id, digits)))
      .limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "PO", id: r.id, label: `PO #${r.id}${r.supplierName ? ` — ${r.supplierName}` : ""} (${r.status})`, path: `/erp/${r.id}` });
  }

  if (digits && await canRead(db, user, "work_orders")) {
    const rows = await db.select().from(workOrders).where(and(idPrefix(workOrders.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "WO", id: r.id, label: `WO #${r.id} (${r.status})`, path: `/work-orders/${r.id}` });
  }

  if (digits && await canRead(db, user, "audit")) {
    const rows = await db.select().from(audits).where(and(eq(audits.siteId, req.siteId ?? -1), idPrefix(audits.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Audit", id: r.id, label: `Audit #${r.id} — ${r.name}`, path: `/audits/${r.id}` });
  }

  if (digits && await canRead(db, user, "rma")) {
    const rows = await db.select().from(rma).where(and(idPrefix(rma.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "RMA", id: r.id, label: `RMA ${r.rmaNumber} (${r.status})`, path: `/rma/${r.id}` });
  }

  if (digits && await canRead(db, user, "eight_d")) {
    const rows = await db.select().from(eightD).where(and(idPrefix(eightD.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "8D", id: r.id, label: `8D #${r.id}${r.ncrId ? ` (NCR #${r.ncrId})` : ""}`, path: `/8d/${r.id}` });
  }

  if (digits && await canRead(db, user, "complaints")) {
    const rows = await db.select().from(complaints).where(and(idPrefix(complaints.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Complaint", id: r.id, label: `Complaint #${r.id}${r.customerName ? ` — ${r.customerName}` : ""}`, path: `/complaints/${r.id}` });
  }

  if (digits && await canRead(db, user, "change")) {
    const rows = await db.select().from(changeRequests).where(and(idPrefix(changeRequests.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Change", id: r.id, label: `Change #${r.id} — ${r.title}`, path: `/change/${r.id}` });
  }

  if (digits && await canRead(db, user, "risk")) {
    const rows = await db.select().from(riskAssessments).where(and(idPrefix(riskAssessments.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Risk", id: r.id, label: `Risk #${r.id} — ${r.title}`, path: `/risk/${r.id}` });
  }

  if (digits && await canRead(db, user, "ppap")) {
    const rows = await db.select().from(ppapPackages).where(and(idPrefix(ppapPackages.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "PPAP", id: r.id, label: `PPAP #${r.id} — ${r.partNumber}`, path: `/ppap/${r.id}` });
  }

  if (await canRead(db, user, "suppliers")) {
    const conditions = digits ? idPrefix(suppliers.id, digits) : ilike(suppliers.name, `${q}%`);
    const rows = await db.select().from(suppliers).where(and(conditions)).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Supplier", id: r.id, label: `Supplier #${r.id} — ${r.name}`, path: `/suppliers/${r.id}` });
  }

  if (await canRead(db, user, "inventory")) {
    // Inventory Item # is realistically the SKU, not the bare serial id — search matches either.
    const conditions = digits ? idPrefix(inventoryItems.id, digits) : ilike(inventoryItems.sku, `${q}%`);
    const rows = await db.select().from(inventoryItems).where(and(conditions)).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Item", id: r.id, label: `${r.sku}${r.description ? ` — ${r.description}` : ""}`, path: `/inventory/${r.id}` });
  }

  if (digits) {
    // Training: no ResourceKey in PERMISSION_MATRIX at all — read-by-everyone, same as the real /training routes (no department gate there either).
    const trainingRows = await db.select().from(trainingCourses).where(and(idPrefix(trainingCourses.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of trainingRows) results.push({ type: "Training", id: r.id, label: `Course #${r.id} — ${r.title}`, path: `/training/${r.id}` });

    if (await canRead(db, user, "calibration")) {
      const equipmentRows = await db.select().from(equipment).where(and(idPrefix(equipment.id, digits))).limit(RESULTS_PER_TYPE);
      for (const r of equipmentRows) results.push({ type: "Calibration", id: r.id, label: `${r.name} (#${r.id})`, path: `/calibration/${r.id}` });
    }
  }

  res.json({ results });
});
