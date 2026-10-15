import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError.js";
import { ADMIN_CONSOLE_PERMISSION } from "../modules/roles/roleAccess.js";
import { loadRolePermissions } from "../modules/roles/rolePermissions.js";
import { db as rootDb } from "../db/index.js";
import type { Db } from "../lib/requestDb.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/** Supplier portal logins do not read company settings, roles, or the staff directory. Must run after `requireAuth`. */
export function rejectSupplierReads(req: Request, _res: Response, next: NextFunction) {
  if ((req.method === "GET" || req.method === "HEAD") && req.user?.roleName === "supplier") {
    next(AppError.forbidden("Supplier logins can't open this."));
    return;
  }
  next();
}

/** Allows the route only when the signed-in person's role carries this permission. Admin assigns it on the Roles page. Must run after `requireAuth`. */
export function requireRolePermission(permission: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw AppError.unauthorized();
    const granted = await loadRolePermissions((req.db ?? rootDb) as Db, req.user.roleName);
    if (!granted.includes(permission)) throw AppError.forbidden("Your role doesn't have permission to do this.");
    next();
  });
}

/** Admin console routes. Admin assigns this on the Roles page; Owner and Administrator start with it. */
export const requireFullAccess = requireRolePermission(ADMIN_CONSOLE_PERMISSION);
