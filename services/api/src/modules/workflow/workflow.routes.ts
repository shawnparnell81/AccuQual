import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createWorkflowSchema, runWorkflowSchema } from "./workflow.validation.js";
import { listHandler, createHandler, runHandler } from "./workflow.controller.js";

export const workflowRouter = Router();
workflowRouter.use(requireAuth, withTenantDb);

workflowRouter.get("/", listHandler);
workflowRouter.post("/", validate(createWorkflowSchema), createHandler);
workflowRouter.post("/:id/run", validate(runWorkflowSchema), runHandler);
