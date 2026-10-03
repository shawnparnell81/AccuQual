import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { z } from "zod";
import { csaPdfHandler, getCsaHandler, listCsaHandler, saveCsaResultsHandler, submitCsaHandler } from "./csaFai.controller.js";

const submitSchema = z.object({
  partNumber: z.string().min(1),
  partDescription: z.string().min(1),
  supplierName: z.string().min(1),
  supplierId: z.number().int().positive().nullable().optional(),
  supplierPartNumber: z.string().min(1),
  sampleLotNumber: z.string().min(1),
  vehicleYear: z.string().min(1),
  vehicleMake: z.string().min(1),
  vehicleModel: z.string().min(1),
  position: z.string().min(1),
  inspectorName: z.string().min(1),
  inspectorUserId: z.number().int().positive().nullable().optional(),
  dateOpened: z.string().optional(),
  dampingTestRequired: z.boolean().optional(),
  vehicleFitmentPerformed: z.boolean().optional(),
}).strict();

const resultsSchema = z.object({
  branch: z.enum(["component", "dimensional", "functional", "fitment"]),
  entries: z.array(z.object({
    key: z.string(),
    result: z.string().optional(),
    actual: z.string().nullable().optional(),
    units: z.string().nullable().optional(),
    specifiedLimits: z.string().nullable().optional(),
    equipment: z.string().nullable().optional(),
    comments: z.string().nullable().optional(),
    photos: z.array(z.object({ fileName: z.string(), caption: z.string().optional() })).optional(),
  })).max(80),
});

export const csaFaiRouter = Router();
csaFaiRouter.get("/", listCsaHandler);
csaFaiRouter.post("/", validate(submitSchema), submitCsaHandler);
csaFaiRouter.get("/:id/pdf", csaPdfHandler);
csaFaiRouter.get("/:id", getCsaHandler);
csaFaiRouter.put("/:id/results", validate(resultsSchema), saveCsaResultsHandler);
