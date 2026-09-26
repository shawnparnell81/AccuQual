import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createRmaLogSchema, updateRmaLogSchema, transitionRmaLogSchema } from "./rmaLog.validation.js";
import { listRmaLogHandler, createRmaLogHandler, getRmaLogHandler, updateRmaLogHandler, transitionRmaLogHandler } from "./rmaLog.controller.js";

export const rmaLogRouter = Router();
// rma_log.read/write per the module-specific RBAC brief — Quality/Customer
// Service edit by default, Engineering/Purchasing/Material Management
// read (see db/defaultPermissions.ts). Per-action narrowing beyond this
// base level (rma_log.status.write, rma_log.linkage.write) is enforced
// inline in rmaLog.controller.ts, same "matrix grants edit, controller
// narrows" pattern as every other module in this app.
rmaLogRouter.use(requireAuth, withDb, requireDepartmentAccess("rma_log"));

rmaLogRouter.get("/", listRmaLogHandler);
rmaLogRouter.post("/", validate(createRmaLogSchema), createRmaLogHandler);
rmaLogRouter.get("/:id", getRmaLogHandler);
rmaLogRouter.patch("/:id", validate(updateRmaLogSchema), updateRmaLogHandler);
rmaLogRouter.post("/:id/status", validate(transitionRmaLogSchema), transitionRmaLogHandler);
