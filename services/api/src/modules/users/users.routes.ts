import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireFullAccess, requireRolePermission } from "../../middleware/rbac.js";
import { USERS_LIST_PERMISSION, ADMIN_CONSOLE_PERMISSION } from "../roles/roleAccess.js";
import { validate } from "../../middleware/validate.js";
import { withDb } from "../../lib/requestDb.js";
import { createUserSchema, updateUserSchema, updateUserDisplayOrderSchema, temporaryPasswordSchema, updateMyThemeSchema, updateMyChangelogSeenSchema, updateMySavedViewsSchema, updateMySidebarShortcutsSchema, updateMyWorkspaceLayoutSchema, updateMyProfileSchema } from "./users.validation.js";
import { listUsers, updateUserDisplayOrder, getUser, createUser, updateUser, deleteUser, getUserOpenWork, unlockUser, resetUserMfa, setTemporaryPassword, getMyTheme, updateMyTheme, getMyChangelogSeen, updateMyChangelogSeen, getMySavedViews, updateMySavedViews, getMySidebarShortcuts, updateMySidebarShortcuts, getMyWorkspaceLayout, updateMyWorkspaceLayout, resetMyWorkspaceLayout } from "./users.controller.js";
import { accessPreviewHandler, getUserAvatar, onboardingCatalogHandler, updateMyProfile } from "./teamMember.controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, withDb);

usersRouter.get("/", requireRolePermission(USERS_LIST_PERMISSION), listUsers);
usersRouter.put("/display-order", requireFullAccess, validate(updateUserDisplayOrderSchema), updateUserDisplayOrder);
usersRouter.post("/", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(createUserSchema), createUser);

// Any authenticated user, own row only — see getMyTheme/updateMyTheme's own
// comment. Two path segments, so this never collides with GET/PATCH /:id.
usersRouter.get("/onboarding-catalog", requireRolePermission(ADMIN_CONSOLE_PERMISSION), onboardingCatalogHandler);
usersRouter.get("/access-preview", requireRolePermission(ADMIN_CONSOLE_PERMISSION), accessPreviewHandler);
usersRouter.patch("/me/profile", validate(updateMyProfileSchema), updateMyProfile);
usersRouter.get("/:id/avatar", getUserAvatar);

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

usersRouter.get("/:id/open-work", requireRolePermission(ADMIN_CONSOLE_PERMISSION), getUserOpenWork);
usersRouter.get("/:id", getUser);
usersRouter.patch("/:id", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateUserSchema), updateUser);
usersRouter.delete("/:id", requireRolePermission(ADMIN_CONSOLE_PERMISSION), deleteUser);
usersRouter.post("/:id/unlock", requireRolePermission(ADMIN_CONSOLE_PERMISSION), unlockUser);
usersRouter.post("/:id/mfa/reset", requireRolePermission(ADMIN_CONSOLE_PERMISSION), resetUserMfa);
usersRouter.post("/:id/temporary-password", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(temporaryPasswordSchema), setTemporaryPassword);
