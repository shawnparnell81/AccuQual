import { eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { tenants, type Tenant } from "../../drizzle/schema/tenants.js";
import { AppError } from "../../utils/appError.js";

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

export function getFeasibilitySettings(tenant: Tenant): FeasibilitySettings {
  return tenant.feasibilitySettings ?? {};
}

export function getInventorySettings(tenant: Tenant): InventorySettings {
  return tenant.inventorySettings ?? {};
}

export function getErpSyncSettings(tenant: Tenant): ErpSyncSettings {
  return tenant.erpSyncSettings ?? {};
}
