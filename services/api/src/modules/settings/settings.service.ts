import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company, type Company } from "../../drizzle/schema/company.js";
import { documents } from "../../drizzle/schema/documents.js";
import { AppError } from "../../utils/appError.js";
import { normalizeRequiredDocumentIds } from "./requiredDocuments.js";

/**
 * Shared load for every settings domain below (Feasibility/Inventory/ERP
 * Sync) — same "self-service settings for the company" reasoning as modules/company/company.controller.ts's own
 * loadCompany, factored out here since three modules (settings.controller.ts,
 * feasibility.controller.ts, inventory.service.ts/inventory.costing.ts) all
 * need to read this same row without duplicating the query.
 */
export async function loadCompanyForSettings(db: Db): Promise<Company> {
  const [co] = await db.select().from(company);
  if (!co) throw AppError.notFound("Company");
  return co;
}

export type FeasibilitySettings = NonNullable<Company["feasibilitySettings"]>;
export type InventorySettings = NonNullable<Company["inventorySettings"]>;
export type ErpSyncSettings = NonNullable<Company["erpSyncSettings"]>;
export type SupplierRiskSettings = NonNullable<Company["supplierRiskWeights"]>;
export type ReceivingSettings = NonNullable<Company["receivingSettings"]>;

export function getFeasibilitySettings(co: Company): FeasibilitySettings {
  const stored = co.feasibilitySettings ?? {};
  return { ...stored, requiredDocuments: normalizeRequiredDocumentIds(stored.requiredDocuments) };
}

/**
 * POST /settings/feasibility — requiredDocuments may only name documents
 * this company can still use. Duplicate ids are rejected. A soft-deleted
 * row or another company's id is inaccessible.
 */
export async function assertAccessibleRequiredDocuments(db: Db, ids: string[]): Promise<void> {
  const seen = new Set<string>();
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  if (duplicates.length > 0) throw AppError.badRequest("Duplicate required documents are not allowed.");
  if (ids.length === 0) return;

  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, ids.map(Number)), eq(documents.isDeleted, false)));
  const found = new Set(rows.map((row) => String(row.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw AppError.badRequest(`Unknown or inaccessible document(s): ${missing.join(", ")}.`);
}

/** Titles for finalize's missing-document error. Falls back to "Document #id" when the row is gone. */
export async function requiredDocumentDisplayNames(db: Db, ids: string[]): Promise<string[]> {
  const numericIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (numericIds.length === 0) return ids.map((id) => `Document #${id}`);
  const rows = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(inArray(documents.id, numericIds)));
  const titles = new Map(rows.map((row) => [String(row.id), row.title]));
  return ids.map((id) => titles.get(id) || `Document #${id}`);
}

export function getInventorySettings(co: Company): InventorySettings {
  return co.inventorySettings ?? {};
}

export function getErpSyncSettings(co: Company): ErpSyncSettings {
  return co.erpSyncSettings ?? {};
}

export function getSupplierRiskSettings(co: Company): SupplierRiskSettings {
  return co.supplierRiskWeights ?? {};
}

export function getReceivingSettings(co: Company): ReceivingSettings {
  return co.receivingSettings ?? {};
}
