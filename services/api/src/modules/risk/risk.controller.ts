import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { riskAssessments, fmeaItems } from "../../drizzle/schema/risk.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(riskAssessments, { entityName: "Risk assessment", idColumn: "id" });

export const addFmeaItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const riskAssessmentId = Number(req.params.id);
  const [risk] = await req
    .db!.select()
    .from(riskAssessments)
    .where(and(eq(riskAssessments.id, riskAssessmentId), eq(riskAssessments.tenantId, req.tenantId!)));
  if (!risk) throw AppError.notFound("Risk assessment");

  const { severity, occurrence, detection } = req.body;
  const rpn = severity * occurrence * detection;

  const [item] = await req
    .db!.insert(fmeaItems)
    .values({ ...req.body, riskAssessmentId, tenantId: req.tenantId!, rpn: String(rpn) })
    .returning();
  res.status(201).json(item);
});

export const listFmeaItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req
    .db!.select()
    .from(fmeaItems)
    .where(and(eq(fmeaItems.riskAssessmentId, Number(req.params.id)), eq(fmeaItems.tenantId, req.tenantId!)));
  res.json(items);
});
