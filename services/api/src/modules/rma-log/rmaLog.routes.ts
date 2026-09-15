import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { listRmaLogHandler } from "./rmaLog.controller.js";

export const rmaLogRouter = Router();
// Quality edit (the module's real owner — see departmentAccess.ts's own
// comment; there's no user-facing write action, every row is written by
// the supplier-RMA pipeline itself), Customer Service read, per the
// brief's own RBAC table.
rmaLogRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("rma_log"));

rmaLogRouter.get("/", listRmaLogHandler);
