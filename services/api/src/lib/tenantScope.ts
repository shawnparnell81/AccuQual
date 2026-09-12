import type { NextFunction, Request, Response } from "express";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import * as schema from "../drizzle/schema/index.js";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";
// Importing this (even just for its type) pulls its `declare global` Request.user
// augmentation into any program that includes this file — needed because the
// workers import this module directly for the TenantDb type, in a separate
// tsc program that never otherwise sees middleware/auth.ts.
import type { AuthenticatedUser } from "../middleware/auth.js";

export type TenantDb = NodePgDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Per-request, transaction-scoped Drizzle instance with `app.current_tenant_id` set for RLS. */
      db?: TenantDb;
      tenantId?: number;
    }
  }
}

/**
 * Opens one Postgres transaction per request, sets `app.current_tenant_id`
 * via `SET LOCAL` (real for the lifetime of this transaction only — never
 * leaks to another request on the same pooled connection), and hands the
 * transaction-bound Drizzle instance to the route as `req.db`. Commits on a
 * successful response, rolls back otherwise. Must run after `requireAuth`.
 *
 * Every module's queries still filter by `req.tenantId` explicitly — this
 * middleware is the second, DB-level layer (see rls-policies.sql), not a
 * replacement for the first.
 */
export function withTenantDb(req: Request, res: Response, next: NextFunction) {
  const user: AuthenticatedUser | undefined = req.user;
  if (!user?.tenantId) {
    return next(AppError.unauthorized("Missing tenant context"));
  }

  const tenantId = user.tenantId;

  pool
    .connect()
    .then(async (client: PoolClient) => {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);

      req.tenantId = tenantId;
      req.db = drizzle(client, { schema });

      let settled = false;
      const finish = async () => {
        if (settled) return;
        settled = true;
        try {
          await client.query(res.statusCode >= 400 ? "ROLLBACK" : "COMMIT");
        } catch (err) {
          logger.error("Failed to finalize tenant transaction", err);
        } finally {
          client.release();
        }
      };

      res.on("finish", finish);
      res.on("close", finish);

      next();
    })
    .catch((err) => next(err));
}

/** For the small number of platform-admin routes that are inherently cross-tenant. */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || req.user.roleName !== "platform_admin") {
    return next(AppError.forbidden("Requires platform admin"));
  }
  next();
}
