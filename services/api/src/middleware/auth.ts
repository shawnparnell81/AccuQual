import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/appError.js";
import { db } from "../db/index.js";
import { users } from "../drizzle/schema/users.js";

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

/**
 * Requires a valid `Authorization: Bearer <accessToken>` header, and that the
 * account behind it is still allowed in.
 *
 * The token's signature proves who issued it, not that the user is still
 * active or that their session wasn't revoked since. So each request also
 * reads the user's live `is_active` and `token_version` (one primary-key
 * lookup, on the owner connection because auth runs before any tenant
 * context exists): a deactivated user, or one whose sessions were revoked by
 * logout / password reset / role change, is refused at once rather than
 * carrying on until the 15-minute token expires.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw AppError.unauthorized("Missing bearer token");
    }

    const token = header.slice("Bearer ".length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw AppError.unauthorized("Invalid or expired token");
    }

    const [live] = await db.select({ isActive: users.isActive, tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, Number(payload.sub)));
    if (!live || !live.isActive) throw AppError.unauthorized("Session is no longer valid");
    if (payload.tv !== undefined && payload.tv !== live.tokenVersion) throw AppError.unauthorized("Session has been revoked");

    req.user = {
      id: Number(payload.sub),
      tenantId: payload.tenantId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      department: payload.department,
      supplierId: payload.supplierId ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
}
