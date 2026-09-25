import { and, eq, inArray } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { tenants, type Tenant } from "../../drizzle/schema/tenants.js";
import { documents } from "../../drizzle/schema/documents.js";
import { AppError } from "../../utils/appError.js";
import { normalizeRequiredDocumentIds } from "./requiredDocuments.js";

/**
 * Shared load for every settings domain below (Feasibility/Inventory/ERP
 * Sync) — same "self-service settings for the CURRENT tenant only, scoped
 * by req.tenantId" reasoning as modules/tenant/tenant.controller.ts's own
 * loadTenant, factored out here since three modules (settings.controller.ts,
 * feasibility.controller.ts, inventory.service.ts/inventory.costing.ts) all
 * need to read this same row without duplicating the query.
 */
export async function loadTenantForSettings(db: TenantDb, tenantId: number): Promise<Tenant> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw AppError.notFound("Tenant");
  return tenant;
}

export type FeasibilitySettings = NonNullable<Tenant["feasibilitySettings"]>;
export type InventorySettings = NonNullable<Tenant["inventorySettings"]>;
export type ErpSyncSettings = NonNullable<Tenant["erpSyncSettings"]>;
export type SupplierRiskSettings = NonNullable<Tenant["supplierRiskWeights"]>;
export type ReceivingSettings = NonNullable<Tenant["receivingSettings"]>;

export function getFeasibilitySettings(tenant: Tenant): FeasibilitySettings {
  const stored = tenant.feasibilitySettings ?? {};
  return { ...stored, requiredDocuments: normalizeRequiredDocumentIds(stored.requiredDocuments) };
}

/**
 * POST /settings/feasibility — requiredDocuments may only name documents
 * this tenant can still use. Duplicate ids are rejected. A soft-deleted
 * row or another tenant's id is inaccessible.
 */
export async function assertAccessibleRequiredDocuments(db: TenantDb, ids: string[]): Promise<void> {
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
export async function requiredDocumentDisplayNames(db: TenantDb, ids: string[]): Promise<string[]> {
  const numericIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (numericIds.length === 0) return ids.map((id) => `Document #${id}`);
  const rows = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(inArray(documents.id, numericIds)));
  const titles = new Map(rows.map((row) => [String(row.id), row.title]));
  return ids.map((id) => titles.get(id) || `Document #${id}`);
}

export function getInventorySettings(tenant: Tenant): InventorySettings {
  return tenant.inventorySettings ?? {};
}

export function getErpSyncSettings(tenant: Tenant): ErpSyncSettings {
  return tenant.erpSyncSettings ?? {};
}

export function getSupplierRiskSettings(tenant: Tenant): SupplierRiskSettings {
  return tenant.supplierRiskWeights ?? {};
}

export function getReceivingSettings(tenant: Tenant): ReceivingSettings {
  return tenant.receivingSettings ?? {};
}
