import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { TenantDb } from "../../lib/tenantScope.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import * as schema from "../../drizzle/schema/index.js";
import { logger } from "../../utils/logger.js";

interface RecordAuditTrailInput {
  tenantId: number;
  entityType: string;
  entityId: number;
  action: "create" | "update" | "delete" | "status_change" | "transition_failed";
  changes?: unknown;
  performedBy?: number;
}

/** Appends an immutable audit trail entry. Never throws — logging must not break the request. */
export async function recordAuditTrail(db: TenantDb, input: RecordAuditTrailInput): Promise<void> {
  try {
    await db.insert(auditTrail).values({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      changes: input.changes as Record<string, unknown> | undefined,
      performedBy: input.performedBy,
    });
  } catch (err) {
    logger.error("Failed to record audit trail entry", { input, err });
  }
}

/**
 * Same as recordAuditTrail(), but for the one case it can't cover: logging a
 * FAILED transition from the global error handler. withTenantDb (see
 * lib/tenantScope.ts) runs every request in its own transaction and rolls it
 * back whenever the response is an error — reusing req.db here would insert
 * the failure record into the very transaction that's about to be discarded,
 * silently losing it. This opens a short-lived, independent connection off
 * the shared pool instead, sets the same `app.current_tenant_id` RLS setting
 * withTenantDb would have set, and commits on its own — so the record
 * survives regardless of what happens to the request's own transaction.
 * Never throws, same as recordAuditTrail().
 */
export async function recordAuditTrailStandalone(pool: Pool, input: RecordAuditTrailInput): Promise<void> {
  const client = await pool.connect().catch((err) => {
    logger.error("Failed to check out a connection for a failed-transition audit entry", { input, err });
    return null;
  });
  if (!client) return;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(input.tenantId)]);
    const db = drizzle(client, { schema });
    await db.insert(auditTrail).values({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      changes: input.changes as Record<string, unknown> | undefined,
      performedBy: input.performedBy,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error("Failed to record a standalone (failed-transition) audit trail entry", { input, err });
  } finally {
    client.release();
  }
}
