import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/appError.js";

export interface AuthenticatedUser {
  id: number;
  tenantId: number | null;
  roleId: number | null;
  roleName: string | null;
  department: string | null;
  // Set only for roleName:"supplier" (Supplier Portal) logins — see
  // users.ts's supplierId column comment.
  supplierId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Requires a valid `Authorization: Bearer <accessToken>` header. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: Number(payload.sub),
      tenantId: payload.tenantId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      department: payload.department,
      supplierId: payload.supplierId ?? null,
    };
    next();
  } catch {
    throw AppError.unauthorized("Invalid or expired token");
  }
}
