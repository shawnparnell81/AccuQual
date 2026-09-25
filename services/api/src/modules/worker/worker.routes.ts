import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { getMyWorkerHandler, getWorkerHandler, listWorkersHandler, upsertWorkerHandler } from "./worker.controller.js";

export const workerRouter = Router();
workerRouter.use(requireAuth, withDb);

const view = requirePermission("workerProfile.view");
const manage = requirePermission("workerProfile.manage");

// Fixed path first — "me" must never be read as a :userId.
workerRouter.get("/me", getMyWorkerHandler);
workerRouter.get("/", view, listWorkersHandler);
workerRouter.get("/:userId", view, getWorkerHandler);
workerRouter.patch("/:userId", manage, upsertWorkerHandler);
