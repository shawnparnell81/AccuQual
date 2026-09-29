import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createWorkflowSchema, updateWorkflowSchema, runWorkflowSchema } from "./workflow.validation.js";
import { registerVersionRoutes } from "../versioning/versioning.routes.js";
import { workflowAdapter } from "../versioning/adapters.js";
import { getHandler, listHandler, createHandler, updateHandler, deleteHandler, runHandler, historyHandler, healthHandler, templatesHandler, actionKindsHandler } from "./workflow.controller.js";

export const workflowRouter = Router();
workflowRouter.use(requireAuth, withDb);
// Record history follows the record's own module, not the workflow builder.
workflowRouter.get("/history/:moduleName/:recordId", withSiteContext, historyHandler);
// Creating or running a definition still needs the workflow module.
workflowRouter.use(requireDepartmentAccess("workflow"));
workflowRouter.get("/health", healthHandler);
workflowRouter.get("/templates", templatesHandler);
workflowRouter.get("/action-kinds", actionKindsHandler);

workflowRouter.get("/", listHandler);
workflowRouter.get("/:id", getHandler);
workflowRouter.post("/", validate(createWorkflowSchema), createHandler);
workflowRouter.patch("/:id", validate(updateWorkflowSchema), updateHandler);
workflowRouter.delete("/:id", deleteHandler);
workflowRouter.post("/:id/run", validate(runWorkflowSchema), runHandler);

// Draft -> review -> publish lifecycle, version history, diff and rollback (shared with Management Review and Context of the Organization).
registerVersionRoutes(workflowRouter, { adapter: workflowAdapter, permission: "workflow" });
