import { AppError } from "../../utils/appError.js";

export interface SiteChoice {
  id: number;
  isDefault: boolean;
  status: string;
}

/** Tenant admins manage every plant. Everyone else is limited to membership. */
export function isSiteAdmin(roleName: string | null | undefined): boolean {
  return roleName === "admin";
}

/** Short code stored on the plant. Callers may pass an explicit code instead. */
export function slugifyPlantCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "plant";
}

/**
 * Which plant this request is working in.
 * An explicit header wins (so two tabs can sit on different plants), then
 * the plant saved on the user, then the default plant they can actually use.
 */
export function pickCurrentSiteId(input: {
  allowedIds: number[];
  headerSiteId: number | null;
  savedSiteId: number | null;
  sites: SiteChoice[];
}): number | null {
  const allowed = new Set(input.allowedIds);
  if (input.headerSiteId != null && allowed.has(input.headerSiteId)) return input.headerSiteId;
  if (input.savedSiteId != null && allowed.has(input.savedSiteId)) return input.savedSiteId;
  const active = input.sites.filter((site) => allowed.has(site.id) && site.status === "active");
  return (active.find((site) => site.isDefault) ?? active[0])?.id ?? null;
}

/** Hide a record that lives at a plant this caller cannot open. `allowed` omitted means the caller didn't go through plant resolution (seeds, workers). */
export function assertRecordOnAllowedSite(siteId: number | null | undefined, allowedSiteIds: number[] | undefined, entity: string) {
  if (!allowedSiteIds) return;
  if (siteId == null || !allowedSiteIds.includes(siteId)) throw AppError.notFound(entity);
}
