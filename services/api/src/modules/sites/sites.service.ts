import { and, eq, ne } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { sites, userSites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import { isSiteAdmin, slugifyPlantCode } from "./siteAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export interface SiteView {
  id: number;
  name: string;
  code: string;
  status: string;
  isDefault: boolean;
}

export interface SiteContextView {
  currentSiteId: number | null;
  canManage: boolean;
  sites: SiteView[];
}

async function loadSites(db: TenantDb): Promise<SiteView[]> {
  return db
    .select({ id: sites.id, name: sites.name, code: sites.code, status: sites.status, isDefault: sites.isDefault })
    .from(sites);
}

async function membershipIds(db: TenantDb, userId: number): Promise<number[]> {
  const rows = await db
    .select({ siteId: userSites.siteId })
    .from(userSites)
    .where(and(eq(userSites.userId, userId)));
  return rows.map((row) => row.siteId);
}

export async function getSiteContext(db: TenantDb, userId: number, roleName: string | null): Promise<SiteContextView> {
  const [all, [user]] = await Promise.all([
    loadSites(db),
    db.select({ currentSiteId: users.currentSiteId }).from(users).where(and(eq(users.id, userId))),
  ]);
  const canManage = isSiteAdmin(roleName);
  const allowed = new Set(canManage ? all.map((site) => site.id) : await membershipIds(db, userId));
  const visible = all.filter((site) => allowed.has(site.id));
  const saved = user?.currentSiteId ?? null;
  const currentSiteId = saved != null && allowed.has(saved) ? saved : (visible.find((site) => site.isDefault && site.status === "active") ?? visible.find((site) => site.status === "active"))?.id ?? null;
  return { currentSiteId, canManage, sites: visible };
}

async function uniqueCode(db: TenantDb, base: string): Promise<string> {
  let code = base.slice(0, 40);
  for (let n = 2; n < 50; n++) {
    const [hit] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.code, code)));
    if (!hit) return code;
    code = `${base}-${n}`.slice(0, 40);
  }
  throw AppError.badRequest("Couldn't make a short code for that plant name.");
}

export async function createSite(db: TenantDb, actorId: number, input: { name: string; code?: string }) {
  const code = await uniqueCode(db, input.code ? slugifyPlantCode(input.code) : slugifyPlantCode(input.name));
  const [created] = await db
    .insert(sites)
    .values({ name: input.name.trim(), code, status: "active", isDefault: false })
    .returning();
  if (!created) throw new AppError("Failed to create plant", 500);
  await recordAuditTrail(db, { entityType: "Site", entityId: created.id, action: "create", changes: { name: created.name, code: created.code }, performedBy: actorId });
  return created;
}

export async function updateSite(db: TenantDb, actorId: number, siteId: number, patch: { name?: string; code?: string; status?: "active" | "inactive" }) {
  const [current] = await db.select().from(sites).where(and(eq(sites.id, siteId)));
  if (!current) throw AppError.notFound("Plant");
  if (patch.status === "inactive" && current.isDefault) {
    throw AppError.badRequest("The main plant stays active so existing records keep a home.");
  }
  const next: { name?: string; code?: string; status?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.code !== undefined) {
    const code = slugifyPlantCode(patch.code);
    const [hit] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.code, code), ne(sites.id, siteId)));
    if (hit) throw AppError.badRequest("Another plant already uses that code.");
    next.code = code;
  }
  if (patch.status !== undefined) next.status = patch.status;
  const [updated] = await db.update(sites).set(next).where(and(eq(sites.id, siteId))).returning();
  if (!updated) throw AppError.notFound("Plant");
  await recordAuditTrail(db, { entityType: "Site", entityId: siteId, action: "update", changes: patch, performedBy: actorId });
  return updated;
}

export async function switchSite(db: TenantDb, userId: number, roleName: string | null, siteId: number) {
  const context = await getSiteContext(db, userId, roleName);
  if (!context.sites.some((site) => site.id === siteId)) throw AppError.forbidden("You aren't assigned to that plant.");
  const target = context.sites.find((site) => site.id === siteId);
  if (target && target.status !== "active" && !context.canManage) throw AppError.badRequest("That plant isn't active.");
  await db.update(users).set({ currentSiteId: siteId, updatedAt: new Date() }).where(and(eq(users.id, userId)));
  return { ...context, currentSiteId: siteId };
}

export async function listMemberIds(db: TenantDb, siteId: number): Promise<number[]> {
  const [site] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId)));
  if (!site) throw AppError.notFound("Plant");
  const rows = await db.select({ userId: userSites.userId }).from(userSites).where(and(eq(userSites.siteId, siteId)));
  return rows.map((row) => row.userId);
}

export async function replaceMembers(db: TenantDb, actorId: number, siteId: number, userIds: number[]) {
  const [site] = await db.select().from(sites).where(and(eq(sites.id, siteId)));
  if (!site) throw AppError.notFound("Plant");

  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length > 0) {
    const found = await db.select({ id: users.id }).from(users);
    const known = new Set(found.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !known.has(id));
    if (missing.length > 0) throw AppError.badRequest("One of those people isn't in this organization.");
  }

  const existing = await db.select({ userId: userSites.userId }).from(userSites).where(and(eq(userSites.siteId, siteId)));
  const next = new Set(uniqueIds);
  const removing = existing.map((row) => row.userId).filter((id) => !next.has(id));

  for (const userId of removing) {
    const others = await db
      .select({ siteId: userSites.siteId })
      .from(userSites)
      .where(and(eq(userSites.userId, userId), ne(userSites.siteId, siteId)));
    if (others.length === 0) {
      const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
      const label = person?.name || person?.email || `User #${userId}`;
      throw AppError.badRequest(`${label} must stay assigned to at least one plant.`);
    }
  }

  if (removing.length > 0) {
    for (const userId of removing) {
      await db.delete(userSites).where(and(eq(userSites.siteId, siteId), eq(userSites.userId, userId)));
      const [person] = await db.select({ currentSiteId: users.currentSiteId }).from(users).where(eq(users.id, userId));
      if (person?.currentSiteId === siteId) {
        const [fallback] = await db
          .select({ siteId: userSites.siteId })
          .from(userSites)
          .where(and(eq(userSites.userId, userId)));
        await db.update(users).set({ currentSiteId: fallback?.siteId ?? null, updatedAt: new Date() }).where(eq(users.id, userId));
      }
    }
  }

  const already = new Set(existing.map((row) => row.userId));
  const adding = uniqueIds.filter((id) => !already.has(id));
  if (adding.length > 0) {
    await db.insert(userSites).values(adding.map((userId) => ({ userId, siteId })));
  }

  await recordAuditTrail(db, {
    entityType: "Site",
    entityId: siteId,
    action: "update",
    changes: { members: uniqueIds },
    performedBy: actorId,
  });
  return uniqueIds;
}
