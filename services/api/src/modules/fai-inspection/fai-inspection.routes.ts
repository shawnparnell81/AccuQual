import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import * as c from "./fai-inspection.controller.js";
import { faiRandomPullRouter } from "./fai-random-pull.routes.js";
import { faiNotificationsRouter } from "./fai-notifications.routes.js";
import { faiChartsRouter } from "./fai-charts.routes.js";
import { faiReportsRouter } from "./fai-reports.routes.js";

export const faiInspectionRouter = Router();
faiInspectionRouter.use(requireAuth, withDb, withSiteContext);

// Phase 2 (scheduling): random-pull rules, pick lists, compliance. Separate files; same auth/db/site middleware above.
faiInspectionRouter.use("/random-pulls", faiRandomPullRouter);
// Phase 3: email distribution lists, dashboard charts, and the 4 downloadable reports.
faiInspectionRouter.use("/distribution-lists", faiNotificationsRouter);
faiInspectionRouter.use("/charts", faiChartsRouter);
faiInspectionRouter.use("/reports", faiReportsRouter);

faiInspectionRouter.get("/dashboard", c.dashboard);

faiInspectionRouter.get("/plans", c.listPlans);
faiInspectionRouter.post("/plans", c.createPlan);
faiInspectionRouter.get("/plans/:id", c.getPlan);
faiInspectionRouter.put("/plans/:id", c.updatePlan);

faiInspectionRouter.get("/sources", c.listSources);
faiInspectionRouter.post("/sources/:id/status", c.manualSourceStatus);

faiInspectionRouter.get("/records", c.listRecords);
faiInspectionRouter.post("/records", c.createRecord);
faiInspectionRouter.get("/records/:id", c.getRecord);
faiInspectionRouter.patch("/records/:id", c.updateRecord);
faiInspectionRouter.delete("/records/:id", c.deleteRecord);
faiInspectionRouter.post("/records/:id/lines", c.saveResultLines);
faiInspectionRouter.post("/records/:id/sign", c.signRecord);
faiInspectionRouter.get("/records/:id/pdf", c.recordPdf);
