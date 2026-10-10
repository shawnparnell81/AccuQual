import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { rejectSupplierReads } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { withResolvedActors, attachFieldChanges, labelPersonFields } from "./audit-trail.service.js";
import type { Db } from "../../lib/requestDb.js";
import { ACCOUNT_ENTITY_TYPES, ENTITY_TYPE_TO_RESOURCE, assertCanReadEntityHistory, canSeeCompanyAuditRow, filterCompanyAuditBySite, visibleEntityTypes } from "./auditTrailVisibility.js";

export const auditTrailRouter = Router();

auditTrailRouter.use(requireAuth, withDb, withSiteContext, rejectSupplierReads);

/**
 * Recent record history for staff who are signed in. Supplier logins are
 * refused. Each person sees the record types they can already open, and
 * only at plants they belong to. Another person's sign-in and account rows
 * stay with an owner or administrator. A wider scan is filtered down so a
 * department that cannot see the newest rows still gets its own history.
 */
auditTrailRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const viewer = req.user!;
    const visible = await visibleEntityTypes(req.db! as Db, viewer);
    const rows = await req.db!.select().from(auditTrail).orderBy(desc(auditTrail.id)).limit(400);
    const byType = rows.filter((row) => canSeeCompanyAuditRow(visible, row, viewer.id));
    const onPlant = await filterCompanyAuditBySite(req.db! as Db, byType, viewer, req.allowedSiteIds);
    const allowed = onPlant.slice(0, 200);
    const withActors = await withResolvedActors(req.db! as Db, allowed);
    const withFields = await attachFieldChanges(req.db! as Db, withActors);
    res.json(await labelPersonFields(req.db! as Db, withFields));
  }),
);

/** History for a single entity, e.g. GET /audit-trail/ncr/42 */
auditTrailRouter.get(
  "/:entityType/:entityId",
  asyncHandler(async (req, res) => {
    const entityType = req.params.entityType!;
    const entityId = Number(req.params.entityId);

    if (!ENTITY_TYPE_TO_RESOURCE[entityType] && !ACCOUNT_ENTITY_TYPES.has(entityType) && entityType !== "DataImport") {
      throw AppError.badRequest(`Unknown record type "${entityType}"`);
    }

    await assertCanReadEntityHistory(req.db! as Db, req.user!, entityType, entityId, req.allowedSiteIds);

    const rows = await req
      .db!.select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityId, Number(req.params.entityId))));
    const filtered = rows.filter((r) => r.entityType === entityType);
    const withActors = await withResolvedActors(req.db! as Db, filtered);
    const withFields = await attachFieldChanges(req.db! as Db, withActors);
    res.json(await labelPersonFields(req.db! as Db, withFields));
  })
);
