import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { withSiteContext } from "../sites/siteContext.js";
import { validate } from "../../middleware/validate.js";
import { assignFaiSchema, assignPullSchema, completePullSchema, faiDecisionSchema, openFaiSchema, savePlanSchema, saveResultsSchema } from "./fai.validation.js";
import { csaFaiRouter } from "../csa-fai/csaFai.routes.js";
import { fuelPumpFaiRouter } from "../fuel-pump-fai/fuelPumpFai.routes.js";
import {
  approveRecordHandler,
  assignPullHandler,
  assignRecordHandler,
  completePullHandler,
  createPlanHandler,
  getPlanHandler,
  getRecordHandler,
  listPlansHandler,
  listPullsHandler,
  listRecordsHandler,
  listSourcesHandler,
  lookupsHandler,
  copyRecordHandler,
  listPreviousRecordsHandler,
  openRecordHandler,
  pdfHandler,
  queueHandler,
  rejectRecordHandler,
  retirePlanHandler,
  saveResultsHandler,
  submitRecordHandler,
  updatePlanHandler,
} from "./fai.controller.js";

export const faiRouter = Router();
faiRouter.use(requireAuth, withDb, withSiteContext, requireDepartmentAccess("fai"));

faiRouter.get("/lookups", lookupsHandler);
faiRouter.get("/queue", queueHandler);
faiRouter.get("/sources", listSourcesHandler);
faiRouter.get("/pulls", listPullsHandler);
faiRouter.post("/pulls/assign", validate(assignPullSchema), assignPullHandler);
faiRouter.post("/pulls/complete", validate(completePullSchema), completePullHandler);

faiRouter.get("/plans", listPlansHandler);
faiRouter.post("/plans", validate(savePlanSchema), createPlanHandler);
faiRouter.get("/plans/:id", getPlanHandler);
faiRouter.put("/plans/:id", validate(savePlanSchema), updatePlanHandler);
faiRouter.post("/plans/:id/retire", retirePlanHandler);

faiRouter.get("/records", listRecordsHandler);
faiRouter.get("/records/previous", listPreviousRecordsHandler);
faiRouter.post("/records/copy", copyRecordHandler);
faiRouter.post("/records", validate(openFaiSchema), openRecordHandler);
faiRouter.get("/records/:id/pdf", pdfHandler);
faiRouter.get("/records/:id", getRecordHandler);
faiRouter.patch("/records/:id/lines", validate(saveResultsSchema), saveResultsHandler);
faiRouter.post("/records/:id/assign", validate(assignFaiSchema), assignRecordHandler);
faiRouter.post("/records/:id/submit", submitRecordHandler);
faiRouter.post("/records/:id/approve", validate(faiDecisionSchema), approveRecordHandler);
faiRouter.post("/records/:id/reject", validate(faiDecisionSchema), rejectRecordHandler);

faiRouter.use("/csa", csaFaiRouter);
faiRouter.use("/fuel-pump", fuelPumpFaiRouter);
