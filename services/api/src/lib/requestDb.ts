import type { NextFunction, Request, Response } from "express";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import * as schema from "../drizzle/schema/index.js";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";
// Importing this (even just for its type) pulls its `declare global` Request.user
// augmentation into any program that includes this file — needed because the
// workers import this module directly for the Db type, in a separate
// tsc program that never otherwise sees middleware/auth.ts.
import type { AuthenticatedUser } from "../middleware/auth.js";

export type Db = NodePgDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Per-request, transaction-scoped Drizzle instance. */
      db?: Db;
      /** Plant the caller is working in. Set by withSiteContext (modules/sites). */
      siteId?: number | null;
      /** Plants this caller may open records in. Admins get every plant. */
      allowedSiteIds?: number[];
    }
  }
}

/**
 * Opens one Postgres transaction per request and hands the transaction-bound
 * Drizzle instance to the route as `req.db`. Commits on a successful
 * response, rolls back otherwise. Must run after `requireAuth`.
 */
export function withDb(req: Request, res: Response, next: NextFunction) {
  const user: AuthenticatedUser | undefined = req.user;
  if (!user) {
    return next(AppError.unauthorized("Not signed in"));
  }

  pool
    .connect()
    .then(async (client: PoolClient) => {
      await client.query("BEGIN");
      // Read by the audit_row_change() trigger (see post-migrate/audit-triggers.sql) so every field-level change records who made it.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(user.id)]);

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
          logger.error("Failed to finalize request transaction", err);
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
          .catch((err) => logger.error("Unexpected error finalizing request transaction", err));
        return res;
      }) as typeof res.json;
      res.send = ((body?: unknown) => {
        finalize()
          .then((ok) => originalSend(ok ? body : undefined))
          .catch((err) => logger.error("Unexpected error finalizing request transaction", err));
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
          .catch((err) => logger.error("Failed to roll back an abandoned request transaction", err))
          .finally(() => client.release());
      });

      next();
    })
    .catch((err) => next(err));
}
