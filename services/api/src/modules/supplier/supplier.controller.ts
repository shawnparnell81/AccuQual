import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { suppliers, supplierScorecards } from "../../drizzle/schema/supplier.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(suppliers, { entityName: "Supplier", idColumn: "id" });

export const addScorecardHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = Number(req.params.id);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, req.tenantId!)));
  if (!supplier) throw AppError.notFound("Supplier");

  const { qualityScore = 0, deliveryScore = 0 } = req.body;
  const overallScore = (Number(qualityScore) + Number(deliveryScore)) / 2;

  const [scorecard] = await req
    .db!.insert(supplierScorecards)
    .values({ ...req.body, supplierId, tenantId: req.tenantId!, overallScore: String(overallScore) })
    .returning();
  res.status(201).json(scorecard);
});
