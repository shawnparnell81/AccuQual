import type { NextFunction, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { sites, userSites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import { roleCanViewAllSites } from "../roles/rolePermissions.js";
import { optionalRows } from "./optionalSql.js";
import { isRetiredPlant, isSiteAdmin, pickCurrentSiteId } from "./siteAccess.js";

export const SITE_HEADER = "x-accuqual-site";

function readRequestedSite(req: Request): { all: boolean; siteId: number | null } {
  const raw = req.header(SITE_HEADER);
  if (raw == null || raw.trim() === "") return { all: false, siteId: null };
  if (raw.trim().toLowerCase() === "all") return { all: true, siteId: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest("Plant id is not valid.");
  return { all: false, siteId: id };
}

/**
 * Resolves the plant for this request. Must run after withDb.
 * Lists and creates for plant-scoped modules use `req.siteId`. Opening a
 * record by id uses `req.allowedSiteIds` so a person can still follow a
 * link to another plant they belong to.
 */
export async function withSiteContext(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.db || !req.user) {
      return next(AppError.unauthorized("Missing company context"));
    }

    const requested = readRequestedSite(req);
    const admin = isSiteAdmin(req.user.roleName);
    const viewAll = await roleCanViewAllSites(req.db, req.user.roleName);
    if (requested.all && !viewAll) return next(AppError.forbidden("You don't have permission to view every site."));
    let headerSiteId = requested.siteId;

    const [siteRows, userRow, membershipRows] = await Promise.all([
      req.db.select({ id: sites.id, isDefault: sites.isDefault, status: sites.status, deletedAt: sites.deletedAt }).from(sites),
      req.db.select({ currentSiteId: users.currentSiteId }).from(users).where(eq(users.id, req.user.id)),
      admin || viewAll
        ? Promise.resolve([] as { siteId: number }[])
        : req.db
            .select({ siteId: userSites.siteId })
            .from(userSites)
            .where(and(eq(userSites.userId, req.user.id))),
    ]);

    const living = siteRows.filter((site) => !isRetiredPlant(site));
    const retired = siteRows.filter((site) => isRetiredPlant(site));
    const retiredIds = new Set(retired.map((site) => site.id));
    // A tab still pointing at a deleted plant must not fail every request.
    if (headerSiteId != null && retiredIds.has(headerSiteId)) headerSiteId = null;

    const seeEveryPlant = admin || viewAll;
    const memberIds = membershipRows.map((row) => row.siteId);
    const allowedLiving = seeEveryPlant ? living.map((site) => site.id) : memberIds.filter((id) => living.some((site) => site.id === id));
    const allowedRetired = seeEveryPlant ? retired.map((site) => site.id) : memberIds.filter((id) => retiredIds.has(id));
    if (headerSiteId != null && !allowedLiving.includes(headerSiteId)) {
      return next(AppError.forbidden("You aren't assigned to that plant."));
    }

    let savedAll = false;
    if (!requested.all && headerSiteId == null) {
      const scopeRows = await optionalRows<{ site_scope: string | null }>(req.db, sql`SELECT site_scope FROM users WHERE id = ${req.user.id}`);
      savedAll = viewAll && scopeRows?.[0]?.site_scope === "all";
    }

    // Retired plants stay in the read set so existing records still open.
    // The working plant is always a living one, even when the list covers every site.
    req.allSites = requested.all || savedAll;
    req.allowUnassigned = Boolean(req.allSites && viewAll);
    req.allowedSiteIds = [...allowedLiving, ...allowedRetired];
    req.siteId = pickCurrentSiteId({
      allowedIds: allowedLiving,
      headerSiteId,
      savedSiteId: userRow[0]?.currentSiteId ?? null,
      sites: living,
    });
    next();
  } catch (err) {
    next(err);
  }
}
