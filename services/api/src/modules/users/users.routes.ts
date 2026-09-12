import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { createUserSchema, updateUserSchema } from "./users.validation.js";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "./users.controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, withTenantDb);

usersRouter.get("/", requireRole("admin", "quality_manager"), listUsers);
usersRouter.post("/", requireRole("admin"), validate(createUserSchema), createUser);
usersRouter.get("/:id", getUser);
usersRouter.patch("/:id", requireRole("admin"), validate(updateUserSchema), updateUser);
usersRouter.delete("/:id", requireRole("admin"), deleteUser);
