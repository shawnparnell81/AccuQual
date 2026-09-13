import type { Request, Response } from "express";
import { and, eq, sql, ilike, type SQLWrapper } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { erpPurchaseOrders } from "../../drizzle/schema/erp.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { audits } from "../../drizzle/schema/audits.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { PERMISSION_MATRIX, type Department, type ResourceKey } from "../../middleware/departmentAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { TenantDb } from "../../lib/tenantScope.js";

const RESULTS_PER_TYPE = 5;

export interface SearchResult {
  type: "NCR" | "CAPA" | "PO" | "WO" | "Audit" | "Supplier" | "Item" | "Training" | "Calibration";
  id: number;
  label: string;
  path: string;
}

/**
 * Same real per-department access already enforced on each module's own
 * routes (see departmentAccess.ts) — a category this user's department has
 * no read access to on the real module is simply never searched, not
 * filtered out after the fact. admin/platform_admin bypass, same as
 * requireDepartmentAccess itself. Training has no ResourceKey at all (see
 * PERMISSION_MATRIX's own comment: read-by-everyone) — always searchable.
 */
function canRead(user: { roleName: string | null; department: string | null }, resourceKey: ResourceKey): boolean {
  if (user.roleName === "admin" || user.roleName === "platform_admin") return true;
  const department = user.department as Department | null;
  const level = (department && PERMISSION_MATRIX[resourceKey][department]) || "none";
  return level !== "none";
}

/** "12" matches ids 12, 120, 123, ... — a prefix match on the id cast to text, never on any title/description column, per "search ONLY by document number or ID". */
function idPrefix(column: SQLWrapper, digits: string) {
  return sql`CAST(${column} AS TEXT) LIKE ${digits + "%"}`;
}

/**
 * GET /search?q=... — read-only across every module's own real table, no
 * new table of its own. "WO" (Work Order) is deliberately never populated:
 * no work_orders table (or module) exists in AccuQual yet — the type stays
 * in the result union so the UI and this contract are ready the moment a
 * real Work Order module ships, rather than fabricating rows against a
 * table that doesn't exist.
 */
export const searchHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as TenantDb;
  const tenantId = req.tenantId!;
  const user = { roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
  const q = String(req.query.q ?? "").trim();

  if (!q) return res.json({ results: [] });

  const digits = /^\d+$/.test(q) ? q : null;
  const results: SearchResult[] = [];

  if (digits && canRead(user, "ncr")) {
    const rows = await db.select().from(ncr).where(and(eq(ncr.tenantId, tenantId), idPrefix(ncr.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "NCR", id: r.id, label: `NCR #${r.id} — ${r.title}`, path: `/ncr/${r.id}` });
  }

  if (digits && canRead(user, "capa")) {
    const rows = await db.select().from(capa).where(and(eq(capa.tenantId, tenantId), idPrefix(capa.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "CAPA", id: r.id, label: `CAPA #${r.id}${r.ncrId ? ` (NCR #${r.ncrId})` : ""}`, path: `/capa/${r.id}` });
  }

  if (digits && canRead(user, "erp")) {
    const rows = await db
      .select({ id: erpPurchaseOrders.id, status: erpPurchaseOrders.status, supplierName: suppliers.name })
      .from(erpPurchaseOrders)
      .leftJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
      .where(and(eq(erpPurchaseOrders.tenantId, tenantId), idPrefix(erpPurchaseOrders.id, digits)))
      .limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "PO", id: r.id, label: `PO #${r.id}${r.supplierName ? ` — ${r.supplierName}` : ""} (${r.status})`, path: `/erp/${r.id}` });
  }

  if (digits && canRead(user, "audit")) {
    const rows = await db.select().from(audits).where(and(eq(audits.tenantId, tenantId), idPrefix(audits.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Audit", id: r.id, label: `Audit #${r.id} — ${r.name}`, path: `/audits/${r.id}` });
  }

  if (canRead(user, "suppliers")) {
    const conditions = digits ? idPrefix(suppliers.id, digits) : ilike(suppliers.name, `${q}%`);
    const rows = await db.select().from(suppliers).where(and(eq(suppliers.tenantId, tenantId), conditions)).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Supplier", id: r.id, label: `Supplier #${r.id} — ${r.name}`, path: `/suppliers/${r.id}` });
  }

  if (canRead(user, "inventory")) {
    // Inventory Item # is realistically the SKU, not the bare serial id — search matches either.
    const conditions = digits ? idPrefix(inventoryItems.id, digits) : ilike(inventoryItems.sku, `${q}%`);
    const rows = await db.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), conditions)).limit(RESULTS_PER_TYPE);
    for (const r of rows) results.push({ type: "Item", id: r.id, label: `${r.sku}${r.description ? ` — ${r.description}` : ""}`, path: `/inventory/${r.id}` });
  }

  if (digits) {
    // Training: no ResourceKey in PERMISSION_MATRIX at all — read-by-everyone, same as the real /training routes (no department gate there either).
    const trainingRows = await db.select().from(trainingCourses).where(and(eq(trainingCourses.tenantId, tenantId), idPrefix(trainingCourses.id, digits))).limit(RESULTS_PER_TYPE);
    for (const r of trainingRows) results.push({ type: "Training", id: r.id, label: `Course #${r.id} — ${r.title}`, path: `/training/${r.id}` });

    if (canRead(user, "calibration")) {
      const equipmentRows = await db.select().from(equipment).where(and(eq(equipment.tenantId, tenantId), idPrefix(equipment.id, digits))).limit(RESULTS_PER_TYPE);
      for (const r of equipmentRows) results.push({ type: "Calibration", id: r.id, label: `${r.name} (#${r.id})`, path: `/calibration/${r.id}` });
    }
  }

  res.json({ results });
});
