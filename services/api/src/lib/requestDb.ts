import { AsyncLocalStorage } from "node:async_hooks";
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
      /** Work that must run only after this request's transaction commits (file removal). */
      afterCommit?: Array<() => Promise<void>>;
    }
  }
}

/** Runs after a successful COMMIT and before the response is sent. A rollback never runs these. */
export function scheduleAfterCommit(req: Request, job: () => Promise<void>) {
  (req.afterCommit ??= []).push(job);
}

/**
 * The request transaction's client, so a few statements can run as the table
 * owner and then return to accuqual_app. The connecting login owns the tables
 * and bypasses row-level security; accuqual_app does not.
 *
 * What accuqual_app can do (post-migrate/rls-policies.sql + audit-triggers.sql,
 * applied by npm run db:migrate — no extra grant in this change):
 *   SELECT/INSERT/UPDATE/DELETE on ordinary public tables, plus sequence usage.
 *   SELECT + INSERT on audit_trail. SELECT only on audit_row_changes and roles.
 * What it cannot do, so those stay on the owner connection:
 *   UPDATE/DELETE/TRUNCATE audit_trail, any write to audit_row_changes,
 *   any write to roles (roles routes never use withDb),
 *   any read or write of refresh_tokens, trusted_devices, mfa_recovery_codes,
 *   and password_reset_tokens (deny-all RLS). Sign-in, refresh, PIN setup,
 *   MFA, and trusted-device screens already use the owner pool. Account
 *   deletion clears those four tables with withTableOwner inside this transaction.
 * Workers, migrations, seeds, and health checks also stay on the owner pool.
 */
const requestClients = new AsyncLocalStorage<PoolClient>();

const APP_ROLE = "accuqual_app";

function explainRoleFailure(err: unknown): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code) : "";
  const text = `${code} ${error.message}`;
  if (!/accuqual_app|42704|42501|set role/i.test(text)) return error;
  error.message =
    "Cannot switch this database login to accuqual_app, so this signed-in request was refused. " +
    "Run migrations as this same login (npm run db:migrate, or the Migrate production database workflow) so the role exists and this login is a member of it. " +
    `Postgres said: ${error.message}`;
  return error;
}

/**
 * Runs `fn` as the table owner on the current request transaction, then
 * switches back to accuqual_app before anything else in the request runs.
 * Used only for the credential tables the app role is denied.
 */
export async function withTableOwner<T>(fn: () => Promise<T>): Promise<T> {
  const client = requestClients.getStore();
  if (!client) {
    throw new Error("Owner-only statements must run inside a request transaction");
  }
  await client.query("SET LOCAL ROLE NONE");
  try {
    const result = await fn();
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    return result;
  } catch (err) {
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`).catch((switchErr) => {
      logger.error("Request transaction stayed aborted; could not switch back to accuqual_app", switchErr);
    });
    throw err;
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
      try {
        await client.query("BEGIN");
        // Read by the audit_row_change() trigger (see post-migrate/audit-triggers.sql) so every field-level change records who made it.
        // Set before the role switch: the setting is transaction-local and the trigger still sees it as accuqual_app.
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(user.id)]);
        // Table owner bypasses the audit revokes and row-level security. This switch is what makes them apply.
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        return next(explainRoleFailure(err));
      }

      requestClients.run(client, () => {
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
            if (wasSuccess) {
              for (const job of req.afterCommit ?? []) {
                await job().catch((err) => logger.error("After-commit job failed", err));
              }
            }
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
      });
    })
    .catch((err) => next(err));
}
