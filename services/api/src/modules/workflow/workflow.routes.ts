import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createWorkflowSchema, runWorkflowSchema } from "./workflow.validation.js";
import { listHandler, createHandler, runHandler, historyHandler } from "./workflow.controller.js";

export const workflowRouter = Router();
workflowRouter.use(requireAuth, withTenantDb);

// Fixed literal path before "/:id/run" — moduleName/recordId are params of
// their own, so there's no real collision risk, but keeping the convention
// used everywhere else in the app (fixed paths before ":id"-shaped ones).
workflowRouter.get("/history/:moduleName/:recordId", historyHandler);

workflowRouter.get("/", listHandler);
workflowRouter.post("/", validate(createWorkflowSchema), createHandler);
workflowRouter.post("/:id/run", validate(runWorkflowSchema), runHandler);
