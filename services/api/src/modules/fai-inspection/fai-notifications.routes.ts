import { Router } from "express";
import * as c from "./fai-notifications.controller.js";

/** Mounted at /fai-inspection/distribution-lists by fai-inspection.routes.ts, which already applies requireAuth/withDb/withSiteContext. */
export const faiNotificationsRouter = Router();

faiNotificationsRouter.get("/", c.listDistributionLists);
faiNotificationsRouter.post("/", c.createDistributionList);
faiNotificationsRouter.patch("/:id", c.updateDistributionList);
faiNotificationsRouter.delete("/:id", c.deleteDistributionList);
