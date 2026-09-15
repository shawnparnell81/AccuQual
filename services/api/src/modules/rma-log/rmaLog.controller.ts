import type { Request, Response } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { rmaLog } from "../../drizzle/schema/supplierRma.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/** GET /rma-log — the Quality/Customer-Service-facing feed of the whole supplier-RMA pipeline (see supplierRma.ts's own schema comment on why this is a real, separate, business-readable table rather than the generic audit_trail). Optional ?rmaId= narrows to one RMA's own timeline. */
export const listRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const { rmaId } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [eq(rmaLog.tenantId, req.tenantId!)];
  if (rmaId) conditions.push(eq(rmaLog.rmaId, Number(rmaId)));

  const rows = await req.db!.select().from(rmaLog).where(and(...conditions)).orderBy(desc(rmaLog.createdAt));
  res.json(rows);
});
