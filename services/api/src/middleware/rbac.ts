import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError.js";

/** Restricts a route to one of the given role names. Must run after `requireAuth`. */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    if (!req.user.roleName || !allowedRoles.includes(req.user.roleName)) {
      throw AppError.forbidden(`Requires one of roles: ${allowedRoles.join(", ")}`);
    }
    next();
  };
}
