import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { createComplaintSchema, updateComplaintSchema } from "./complaints.validation.js";

export const complaintsRouter = Router();
const handlers = crudFactory(complaints, { entityName: "Complaint", idColumn: "id" });

// Complaints is shared by 4 departments (Quality/Engineering/Customer Service:
// edit, Production: read-only) — see departmentAccess.ts.
complaintsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("complaints"));

complaintsRouter.get("/", handlers.list);
complaintsRouter.post("/", validate(createComplaintSchema), handlers.create);
complaintsRouter.get("/:id", handlers.getOne);
complaintsRouter.patch("/:id", validate(updateComplaintSchema), handlers.update);
