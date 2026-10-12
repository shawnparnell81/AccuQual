import { Router } from "express";
import * as c from "./fai-charts.controller.js";

/** Mounted at /fai-inspection/charts. */
export const faiChartsRouter = Router();
faiChartsRouter.get("/pass-rate-by-month", c.passRateByMonth);
faiChartsRouter.get("/by-trigger-reason", c.byTriggerReason);
faiChartsRouter.get("/failures-by-supplier", c.failuresBySupplier);
faiChartsRouter.get("/aging", c.agingOfOpenFais);
