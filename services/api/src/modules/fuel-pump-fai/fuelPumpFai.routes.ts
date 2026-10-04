import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { copyFuelPumpHandler, fuelPumpPdfHandler, getFuelPumpHandler, listFuelPumpHandler, listPreviousFuelPumpHandler, saveFuelPumpResultsHandler, submitFuelPumpHandler } from "./fuelPumpFai.controller.js";

const submitSchema = z.object({
  partNumber: z.string().min(1),
  partDescription: z.string().optional().default(""),
  supplier: z.string().min(1).optional(),
  supplierName: z.string().min(1).optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  supplierPartNumber: z.string().optional().default(""),
  sampleLotNumber: z.string().min(1),
  vehicleYear: z.string().optional().default(""),
  vehicleMake: z.string().optional().default(""),
  vehicleModel: z.string().optional().default(""),
  vehicleEngine: z.string().optional().default(""),
  application: z.string().min(1).optional(),
  vehicleApplication: z.string().min(1).optional(),
  inspector: z.string().min(1).optional(),
  inspectorName: z.string().min(1).optional(),
  inspectorUserId: z.number().int().positive().nullable().optional(),
  validationOwner: z.string().optional().default(""),
  qualityManager: z.string().optional().default(""),
  dateOpened: z.string().optional(),
}).strict().refine((value) => Boolean(value.supplier || value.supplierName), { message: "Supplier is required.", path: ["supplier"] })
  .refine((value) => Boolean(value.application || value.vehicleApplication), { message: "Vehicle Application is required.", path: ["application"] })
  .refine((value) => Boolean(value.inspector || value.inspectorName), { message: "Inspector is required.", path: ["inspector"] });

const resultsSchema = z.object({
  branch: z.enum(["visual", "dimensional", "electrical", "functional", "fitment", "packaging"]),
  entries: z.array(z.object({
    key: z.string(),
    result: z.string().optional(),
    actual: z.string().nullable().optional(),
    units: z.string().nullable().optional(),
    specifiedLimits: z.string().nullable().optional(),
    comments: z.string().nullable().optional(),
    critical: z.boolean().optional(),
    photos: z.array(z.object({ fileName: z.string(), caption: z.string().optional() })).optional(),
  })).max(80),
});

export const fuelPumpFaiRouter = Router();
fuelPumpFaiRouter.get("/", listFuelPumpHandler);
fuelPumpFaiRouter.get("/previous", listPreviousFuelPumpHandler);
fuelPumpFaiRouter.post("/copy", copyFuelPumpHandler);
fuelPumpFaiRouter.post("/", validate(submitSchema), submitFuelPumpHandler);
fuelPumpFaiRouter.get("/:id/pdf", fuelPumpPdfHandler);
fuelPumpFaiRouter.get("/:id", getFuelPumpHandler);
fuelPumpFaiRouter.put("/:id/results", validate(resultsSchema), saveFuelPumpResultsHandler);
