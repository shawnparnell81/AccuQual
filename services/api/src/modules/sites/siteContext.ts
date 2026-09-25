import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { sites, userSites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import { isSiteAdmin, pickCurrentSiteId } from "./siteAccess.js";

export const SITE_HEADER = "x-accuqual-site";

function readHeaderSiteId(req: Request): number | null {
  const raw = req.header(SITE_HEADER);
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest("Plant id is not valid.");
  return id;
}

/**
 * Resolves the plant for this request. Must run after withDb.
 * Lists and creates for plant-scoped modules use `req.siteId`. Opening a
 * record by id uses `req.allowedSiteIds` so a person can still follow a
 * link to another plant they belong to.
 */
export async function withSiteContext(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.db || req.tenantId === undefined || !req.user) {
      return next(AppError.unauthorized("Missing tenant context"));
    }

    const headerSiteId = readHeaderSiteId(req);
    const admin = isSiteAdmin(req.user.roleName);

    const [siteRows, userRow, membershipRows] = await Promise.all([
      req.db.select({ id: sites.id, isDefault: sites.isDefault, status: sites.status }).from(sites),
      req.db.select({ currentSiteId: users.currentSiteId }).from(users).where(eq(users.id, req.user.id)),
      admin
        ? Promise.resolve([] as { siteId: number }[])
        : req.db
            .select({ siteId: userSites.siteId })
            .from(userSites)
            .where(and(eq(userSites.userId, req.user.id))),
    ]);

    const allowedIds = admin ? siteRows.map((site) => site.id) : membershipRows.map((row) => row.siteId);
    if (headerSiteId != null && !allowedIds.includes(headerSiteId)) {
      return next(AppError.forbidden("You aren't assigned to that plant."));
    }

    req.allowedSiteIds = allowedIds;
    req.siteId = pickCurrentSiteId({
      allowedIds,
      headerSiteId,
      savedSiteId: userRow[0]?.currentSiteId ?? null,
      sites: siteRows,
    });
    next();
  } catch (err) {
    next(err);
  }
}
