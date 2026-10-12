import { Router } from "express";
import * as c from "./fai-random-pull.controller.js";

/** Mounted at /fai-inspection/random-pulls by fai-inspection.routes.ts, which already applies requireAuth/withDb/withSiteContext. */
export const faiRandomPullRouter = Router();

faiRandomPullRouter.get("/rules", c.getRules);
faiRandomPullRouter.put("/rules", c.updateRules);

faiRandomPullRouter.get("/batches", c.listBatches);
faiRandomPullRouter.post("/batches", c.generateBatch);
faiRandomPullRouter.get("/batches/:id", c.getBatch);
faiRandomPullRouter.post("/batches/:id/approve", c.approveBatch);

faiRandomPullRouter.post("/items/:id/link", c.linkItem);

faiRandomPullRouter.get("/compliance", c.compliance);
