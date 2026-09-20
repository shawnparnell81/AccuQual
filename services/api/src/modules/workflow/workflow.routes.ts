import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createWorkflowSchema, updateWorkflowSchema, runWorkflowSchema } from "./workflow.validation.js";
import { registerVersionRoutes } from "../versioning/versioning.routes.js";
import { workflowAdapter } from "../versioning/adapters.js";
import { getHandler, listHandler, createHandler, updateHandler, deleteHandler, runHandler, historyHandler, healthHandler, templatesHandler, actionKindsHandler } from "./workflow.controller.js";

export const workflowRouter = Router();
// Phase 9 — previously requireAuth only (any authenticated user of any
// department could create/run a definition that fires real actions
// against this tenant's data — see defaultPermissions.ts's own comment on
// the new "workflow" ResourceKey this now uses).
workflowRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("workflow"));

// Fixed literal paths before "/:id"-shaped ones, same convention used
// everywhere else in the app.
workflowRouter.get("/history/:moduleName/:recordId", historyHandler);
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
