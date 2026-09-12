import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createCapaSchema, updateCapaSchema, verifyCapaSchema } from "./capa.validation.js";
import { baseHandlers, verifyHandler, closeHandler } from "./capa.controller.js";

export const capaRouter = Router();
capaRouter.use(requireAuth, withTenantDb);

capaRouter.get("/", baseHandlers.list);
capaRouter.post("/", validate(createCapaSchema), baseHandlers.create);
capaRouter.get("/:id", baseHandlers.getOne);
capaRouter.patch("/:id", validate(updateCapaSchema), baseHandlers.update);
capaRouter.post("/:id/verify", validate(verifyCapaSchema), verifyHandler);
capaRouter.post("/:id/close", closeHandler);
