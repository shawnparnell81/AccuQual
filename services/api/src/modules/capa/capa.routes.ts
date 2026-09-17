import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createCapaSchema, updateCapaSchema, verifyCapaSchema } from "./capa.validation.js";
import { baseHandlers, listHandler, verifyHandler, closeHandler } from "./capa.controller.js";

export const capaRouter = Router();
// Turns on PERMISSION_MATRIX.capa (quality: edit) — previously unenforced.
capaRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("capa"));

capaRouter.get("/", listHandler);
capaRouter.post("/", validate(createCapaSchema), baseHandlers.create);
capaRouter.get("/:id", baseHandlers.getOne);
capaRouter.patch("/:id", validate(updateCapaSchema), baseHandlers.update);
capaRouter.post("/:id/verify", validate(verifyCapaSchema), verifyHandler);
capaRouter.post("/:id/close", closeHandler);
