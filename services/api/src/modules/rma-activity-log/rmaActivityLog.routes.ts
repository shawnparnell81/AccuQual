import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { listRmaActivityLogHandler } from "./rmaActivityLog.controller.js";

export const rmaActivityLogRouter = Router();
// Quality edit (the module's real owner — see departmentAccess.ts's
// PERMISSION_LABELS/db/defaultPermissions.ts comments; there's no
// user-facing write action, every row is written by the supplier-RMA
// pipeline itself), Customer Service read.
rmaActivityLogRouter.use(requireAuth, withDb, requireDepartmentAccess("rma_activity_log"));

rmaActivityLogRouter.get("/", listRmaActivityLogHandler);
