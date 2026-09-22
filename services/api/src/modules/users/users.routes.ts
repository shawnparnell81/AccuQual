import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { createUserSchema, updateUserSchema, updateMyThemeSchema, updateMyChangelogSeenSchema } from "./users.validation.js";
import { listUsers, getUser, createUser, updateUser, deleteUser, unlockUser, resetUserMfa, getMyTheme, updateMyTheme, getMyChangelogSeen, updateMyChangelogSeen } from "./users.controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, withTenantDb);

usersRouter.get("/", requireRole("admin", "quality_manager"), listUsers);
usersRouter.post("/", requireRole("admin"), validate(createUserSchema), createUser);

// Any authenticated user, own row only — see getMyTheme/updateMyTheme's own
// comment. Two path segments, so this never collides with GET/PATCH /:id.
usersRouter.get("/me/theme", getMyTheme);
usersRouter.patch("/me/theme", validate(updateMyThemeSchema), updateMyTheme);
usersRouter.get("/me/changelog-seen", getMyChangelogSeen);
usersRouter.patch("/me/changelog-seen", validate(updateMyChangelogSeenSchema), updateMyChangelogSeen);

usersRouter.get("/:id", getUser);
usersRouter.patch("/:id", requireRole("admin"), validate(updateUserSchema), updateUser);
usersRouter.delete("/:id", requireRole("admin"), deleteUser);
usersRouter.post("/:id/unlock", requireRole("admin"), unlockUser);
usersRouter.post("/:id/mfa/reset", requireRole("admin"), resetUserMfa);
