import type { NextFunction, Request, Response } from "express";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import * as schema from "../drizzle/schema/index.js";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import { enrichRequestContext } from "../modules/monitoring/requestContext.js";
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
      /** Plant the caller is working in. Set by withSiteContext (modules/sites). */
      siteId?: number | null;
      /** Plants this caller may open records in. Admins get every plant in the tenant. */
      allowedSiteIds?: number[];
    }
  }
}

/**
 * Opens one Postgres transaction per request, switches into the restricted
 * `accuqual_app` role and sets `app.current_tenant_id` (both via `SET
 * LOCAL` — real for the lifetime of this transaction only, never leaks to
 * another request on the same pooled connection), and hands the
 * transaction-bound Drizzle instance to the route as `req.db`. Commits on a
 * successful response, rolls back otherwise. Must run after `requireAuth`.
 *
 * Every module's queries still filter by `req.tenantId` explicitly — that
 * stays the primary, always-active guarantee. The role switch is what makes
 * the RLS policies in rls-policies.sql an actual second, DB-level layer
 * instead of a decorative one: the connection's own login role is the table
 * owner (needed for migrations/platform-admin), and Postgres exempts owners
 * and superusers from RLS regardless of policy — `accuqual_app` has neither
 * property, so a query that somehow forgot its own tenantId filter still
 * can't see another tenant's rows.
 */
export function withTenantDb(req: Request, res: Response, next: NextFunction) {
  const user: AuthenticatedUser | undefined = req.user;
  if (!user?.tenantId) {
    return next(AppError.unauthorized("Missing tenant context"));
  }

  const tenantId = user.tenantId;
  enrichRequestContext({ tenantId });

  pool
    .connect()
    .then(async (client: PoolClient) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE accuqual_app");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);
      // Read by the audit_row_change() trigger (see post-migrate/audit-triggers.sql) so every field-level change records who made it.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(user.id)]);

      req.tenantId = tenantId;
      req.db = drizzle(client, { schema });

      let settled = false;
      /**
       * Commits (or rolls back) BEFORE the response actually reaches the
       * client — not in a `res.on("finish")` listener, which fires only
       * after the bytes are already on the wire. That ordering was a real,
       * demonstrated race: a client that immediately fires a dependent
       * follow-up request (exactly what the R08 integration tests do, and
       * what a fast UI action-then-refetch can do too) could read the row
       * in a *second* transaction before the *first* transaction's async
       * commit had actually finished, seeing pre-write data. Wrapping
       * res.json/res.send here means neither ever flushes until the
       * transaction is truly finalized.
       */
      async function finalize(): Promise<boolean> {
        if (settled) return true;
        settled = true;
        const wasSuccess = res.statusCode < 400;
        try {
          await client.query(wasSuccess ? "COMMIT" : "ROLLBACK");
          return true;
        } catch (err) {
          logger.error("Failed to finalize tenant transaction", err);
          // A failed ROLLBACK on an already-error response isn't a new
          // problem for the client; a failed COMMIT on what looked like a
          // success response means the write did NOT happen — the client
          // must not be told otherwise.
          return !wasSuccess;
        } finally {
          client.release();
        }
      }

      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      res.json = ((body?: unknown) => {
        finalize()
          .then((ok) => originalJson(ok ? body : { error: "InternalServerError", message: "Failed to save changes" }))
          .catch((err) => logger.error("Unexpected error finalizing tenant transaction", err));
        return res;
      }) as typeof res.json;
      res.send = ((body?: unknown) => {
        finalize()
          .then((ok) => originalSend(ok ? body : undefined))
          .catch((err) => logger.error("Unexpected error finalizing tenant transaction", err));
        return res;
      }) as typeof res.send;

      // Fallback only — a request whose response is never actually sent
      // (the client disconnects mid-request) never reaches the overrides
      // above, so this is the one legitimate remaining use of a "close"
      // listener: release the connection rather than leaking it.
      res.on("close", () => {
        if (settled) return;
        settled = true;
        client
          .query("ROLLBACK")
          .catch((err) => logger.error("Failed to roll back an abandoned tenant transaction", err))
          .finally(() => client.release());
      });

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
