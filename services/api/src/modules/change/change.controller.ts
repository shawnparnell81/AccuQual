import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { changeRequests } from "../../drizzle/schema/change.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(changeRequests, { entityName: "Change request", idColumn: "id" });

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [updated] = await req
    .db!.update(changeRequests)
    .set({ status: "approved", approvedBy: req.user?.id, approvedAt: new Date() })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("Change request");
  res.json(updated);
});
