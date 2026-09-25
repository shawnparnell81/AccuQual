import type { Request, Response } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { rmaActivityLog } from "../../drizzle/schema/supplierRma.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * GET /rma-activity-log — renamed from this module's original "rma_log"
 * identity (module-specific RBAC build, 2026-09-16) to free that name for
 * the real, manually-maintained RMA Log register (see modules/rma-log/).
 * This is still the exact same thing it always was: the Quality/Customer-
 * Service-facing feed of the whole supplier-RMA pipeline (see
 * supplierRma.ts's own schema comment on why this is a real, separate,
 * business-readable table rather than the generic audit_trail). Optional
 * ?rmaId= narrows to one RMA's own timeline.
 */
export const listRmaActivityLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const { rmaId } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  if (rmaId) conditions.push(eq(rmaActivityLog.rmaId, Number(rmaId)));

  const rows = await req.db!.select().from(rmaActivityLog).where(and(...conditions)).orderBy(desc(rmaActivityLog.createdAt));
  res.json(rows);
});
