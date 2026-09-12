import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { createComplaintSchema, updateComplaintSchema } from "./complaints.validation.js";

export const complaintsRouter = Router();
const handlers = crudFactory(complaints, { entityName: "Complaint", idColumn: "id" });

complaintsRouter.use(requireAuth, withTenantDb);

complaintsRouter.get("/", handlers.list);
complaintsRouter.post("/", validate(createComplaintSchema), handlers.create);
complaintsRouter.get("/:id", handlers.getOne);
complaintsRouter.patch("/:id", validate(updateComplaintSchema), handlers.update);
