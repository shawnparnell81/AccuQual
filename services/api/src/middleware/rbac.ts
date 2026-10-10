import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError.js";
import { isFullAccessRole } from "../modules/roles/roleAccess.js";

/** Supplier portal logins do not read company settings, roles, or the staff directory. Must run after `requireAuth`. */
export function rejectSupplierReads(req: Request, _res: Response, next: NextFunction) {
  if ((req.method === "GET" || req.method === "HEAD") && req.user?.roleName === "supplier") {
    next(AppError.forbidden("Supplier logins can't open this."));
    return;
  }
  next();
}

/**
 * Owner and Administrator, the same full-access check that already opens
 * user administration. The route does not list role names.
 */
export function requireFullAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw AppError.unauthorized();
  if (!isFullAccessRole(req.user.roleName)) throw AppError.forbidden("Requires an administrator.");
  next();
}

/** Restricts a route to one of the given role names. Must run after `requireAuth`. Owner satisfies every check that names admin. */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    const name = req.user.roleName;
    const allowed = name != null && (allowedRoles.includes(name) || (isFullAccessRole(name) && allowedRoles.includes("admin")));
    if (!allowed) {
      throw AppError.forbidden(`Requires one of roles: ${allowedRoles.join(", ")}`);
    }
    next();
  };
}
