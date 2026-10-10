import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireFullAccess, requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { withDb } from "../../lib/requestDb.js";
import { createUserSchema, updateUserSchema, updateUserDisplayOrderSchema, temporaryPasswordSchema, updateMyThemeSchema, updateMyChangelogSeenSchema, updateMySavedViewsSchema, updateMySidebarShortcutsSchema, updateMyWorkspaceLayoutSchema } from "./users.validation.js";
import { listUsers, updateUserDisplayOrder, getUser, createUser, updateUser, deleteUser, getUserOpenWork, unlockUser, resetUserMfa, setTemporaryPassword, getMyTheme, updateMyTheme, getMyChangelogSeen, updateMyChangelogSeen, getMySavedViews, updateMySavedViews, getMySidebarShortcuts, updateMySidebarShortcuts, getMyWorkspaceLayout, updateMyWorkspaceLayout, resetMyWorkspaceLayout } from "./users.controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, withDb);

usersRouter.get("/", requireRole("admin", "quality_manager"), listUsers);
usersRouter.put("/display-order", requireFullAccess, validate(updateUserDisplayOrderSchema), updateUserDisplayOrder);
usersRouter.post("/", requireRole("admin"), validate(createUserSchema), createUser);

// Any authenticated user, own row only — see getMyTheme/updateMyTheme's own
// comment. Two path segments, so this never collides with GET/PATCH /:id.
usersRouter.get("/me/theme", getMyTheme);
usersRouter.patch("/me/theme", validate(updateMyThemeSchema), updateMyTheme);
usersRouter.get("/me/changelog-seen", getMyChangelogSeen);
usersRouter.patch("/me/changelog-seen", validate(updateMyChangelogSeenSchema), updateMyChangelogSeen);
usersRouter.get("/me/saved-views", getMySavedViews);
usersRouter.patch("/me/saved-views", validate(updateMySavedViewsSchema), updateMySavedViews);
usersRouter.get("/me/sidebar-shortcuts", getMySidebarShortcuts);
usersRouter.put("/me/sidebar-shortcuts", validate(updateMySidebarShortcutsSchema), updateMySidebarShortcuts);
usersRouter.get("/me/workspace-layout", getMyWorkspaceLayout);
usersRouter.put("/me/workspace-layout", validate(updateMyWorkspaceLayoutSchema), updateMyWorkspaceLayout);
usersRouter.delete("/me/workspace-layout", resetMyWorkspaceLayout);

usersRouter.get("/:id/open-work", requireRole("admin"), getUserOpenWork);
usersRouter.get("/:id", getUser);
usersRouter.patch("/:id", requireRole("admin"), validate(updateUserSchema), updateUser);
usersRouter.delete("/:id", requireRole("admin"), deleteUser);
usersRouter.post("/:id/unlock", requireRole("admin"), unlockUser);
usersRouter.post("/:id/mfa/reset", requireRole("admin"), resetUserMfa);
usersRouter.post("/:id/temporary-password", requireRole("admin"), validate(temporaryPasswordSchema), setTemporaryPassword);
