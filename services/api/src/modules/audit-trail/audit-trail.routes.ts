import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { withResolvedActors } from "./audit-trail.service.js";
import type { TenantDb } from "../../lib/tenantScope.js";

export const auditTrailRouter = Router();

auditTrailRouter.use(requireAuth, withTenantDb);

/** History for a single entity, e.g. GET /audit-trail/ncr/42 */
auditTrailRouter.get(
  "/:entityType/:entityId",
  asyncHandler(async (req, res) => {
    const rows = await req
      .db!.select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityId, Number(req.params.entityId)), eq(auditTrail.tenantId, req.tenantId!)));
    const filtered = rows.filter((r) => r.entityType === req.params.entityType);
    res.json(await withResolvedActors(req.db! as TenantDb, filtered));
  })
);
