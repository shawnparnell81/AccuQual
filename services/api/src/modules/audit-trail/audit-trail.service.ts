import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "../../lib/requestDb.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../drizzle/schema/auditRowChanges.js";
import { users } from "../../drizzle/schema/users.js";
import * as schema from "../../drizzle/schema/index.js";
import { logger } from "../../utils/logger.js";

interface RecordAuditTrailInput {
  entityType: string;
  entityId: number;
  // "permission_denied" — module-specific RBAC build (2026-09-16): logged
  // when a real, already-loaded record's update/status/linkage action is
  // blocked by getUserAccessLevel, never for a blocked CREATE (no entity
  // exists yet to attach the row to, and entityId is NOT NULL below — see
  // crar.controller.ts/warranty.controller.ts/rmaLog.controller.ts's own
  // comments on exactly where this fires). A blocked create still shows up
  // in the ordinary structured request log (method/path/status/userId),
  // just not in this entity-scoped table.
  // "decision" — Phase 5 AI feature rollout: a user's explicit accept/reject
  // of an already-generated AI suggestion (see ai.controller.ts's
  // recordSuggestionDecision), always entityType "AiSuggestion" — a
  // separate event from the "create" row generation itself already writes.
  action: "create" | "update" | "delete" | "status_change" | "transition_failed" | "permission_denied" | "decision";
  changes?: unknown;
  performedBy?: number;
}

/**
 * Appends an immutable audit trail entry — inside the caller's own
 * request transaction (`req.db`), not a separate one.
 *
 * DOES throw, deliberately (this used to swallow every error — see the
 * R08 integration tests, which caught this live: a bad `performedBy`
 * FK, or any other constraint violation on this insert, poisons the
 * whole Postgres transaction the same as any other failed statement
 * inside it. Swallowing the JS-level error didn't make that go away —
 * it just hid it, so the transaction was silently rolled back at COMMIT
 * time (Postgres downgrades a COMMIT on an aborted transaction to a
 * ROLLBACK without erroring) while the caller had already sent a 200/201
 * response as if the write had succeeded. Letting this throw lets
 * `asyncHandler` catch it, `errorHandler` produce a real error response,
 * and `withDb`'s `finalize()` issue the ROLLBACK the transaction
 * needs anyway — an honest 500 instead of a false success. Use
 * `recordAuditTrailStandalone` (below) for the one real case that still
 * needs "never throws": logging a failed transition from *outside* any
 * request transaction, in the global error handler.
 */
export async function recordAuditTrail(db: Db, input: RecordAuditTrailInput): Promise<void> {
  await db.insert(auditTrail).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changes: input.changes as Record<string, unknown> | undefined,
    performedBy: input.performedBy,
  });
}

/**
 * Same as recordAuditTrail(), but for the one case it can't cover: logging a
 * FAILED transition from the global error handler. withDb (see
 * lib/requestDb.ts) runs every request in its own transaction and rolls it
 * back whenever the response is an error — reusing req.db here would insert
 * the failure record into the very transaction that's about to be discarded,
 * silently losing it. This opens a short-lived, independent connection off
 * the shared pool instead, sets the same `app.current_tenant_id` RLS setting
 * withDb would have set, and commits on its own — so the record
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
    // Same role switch withDb uses (see tenantScope.ts) — a failed-
    // transition audit entry should be subject to the same real RLS layer
    // as every other tenant-scoped write, not a superuser/owner exception.
    await client.query("SET LOCAL ROLE accuqual_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(input.tenantId)]);
    const db = drizzle(client, { schema });
    await db.insert(auditTrail).values({
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

/**
 * Resolves a set of user ids to a display name in one batched query — used
 * by every history/audit read path (audit-trail.routes.ts,
 * workflow.controller.ts, warranty.controller.ts's claim workflow) so a
 * history panel never shows a bare "User #12" again. Falls back to email
 * when `name` is unset (nullable on the users table), and to
 * "Deleted User (ID #x)" when the id doesn't resolve at all — the FK on
 * audit_trail.performed_by has no cascade today (users are only ever
 * soft-deactivated, never hard-deleted), so that fallback is defensive
 * rather than a case this app currently produces, but a null result here
 * should never silently become "User #undefined" if that ever changes.
 */
export async function resolveUserNames(db: Db, userIds: (number | null | undefined)[]): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((id): id is number => id !== null && id !== undefined))];
  if (ids.length === 0) return new Map();

  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids));
  const byId = new Map(rows.map((u) => [u.id, u.name?.trim() ? u.name : u.email]));

  return new Map(ids.map((id) => [id, byId.get(id) ?? `Deleted User (ID #${id})`]));
}

/**
 * Convenience wrapper for the common shape (a list of rows each carrying
 * their own `performedBy`): attaches `performedByName` — null only when
 * `performedBy` itself is null (a system-initiated action, e.g. the Phase 0
 * CAPA stub-data repair script), rendered as "System" by every caller,
 * matching the convention the frontend already used for a missing actor.
 */
export async function withResolvedActors<T extends { performedBy: number | null }>(db: Db, rows: T[]): Promise<(T & { performedByName: string | null })[]> {
  const names = await resolveUserNames(db, rows.map((r) => r.performedBy));
  return rows.map((r) => ({ ...r, performedByName: r.performedBy === null ? null : (names.get(r.performedBy) ?? null) }));
}

/** audit_trail.entityType -> the table whose row it describes, so a history entry only shows ITS row's field changes. Unlisted types fall back to matching on row id alone within the same transaction. */
const ENTITY_TABLE: Record<string, string> = {
  NCR: "ncr",
  CAPA: "capa",
  "8D Report": "eight_d",
  Audit: "audits",
  "Audit Finding": "audit_items",
  Document: "documents",
  Supplier: "suppliers",
  Complaint: "complaints",
  "Discrepancy investigation": "discrepancy_investigations",
  Equipment: "equipment",
  TrainingAssignment: "training_assignments",
  "Change request": "change_requests",
  RiskAssessment: "risk_assessments",
  WorkOrder: "work_orders",
  PurchaseOrder: "erp_purchase_orders",
  Rma: "rma",
  RmaLog: "rma_log",
  WarrantyClaim: "warranty_claims",
  Crar: "crar",
  Customer: "customers",
  User: "users",
  Company: "tenants",
  FeasibilityReview: "feasibility_reviews",
  QmsForm: "qms_forms",
  ScarForm: "scar_forms",
  QualityInspectionReport: "quality_inspection_reports",
};

export interface FieldChange {
  table: string;
  op: string;
  changes: Record<string, { from?: unknown; to?: unknown }>;
}

/**
 * Adds `fieldChanges` (old -> new per field, from the audit_row_changes
 * trigger) to each audit_trail row, matched on the shared Postgres
 * transaction id + the row the entry is about. One batched query for the
 * whole list. Entries written before the trigger existed (txid null) just
 * get an empty list.
 */
export async function attachFieldChanges<T extends { txid: number | null; entityType: string; entityId: number }>(
  db: Db,
  rows: T[]
): Promise<(T & { fieldChanges: FieldChange[] })[]> {
  const txids = [...new Set(rows.map((r) => r.txid).filter((x): x is number => x !== null && x !== undefined))];
  if (txids.length === 0) return rows.map((r) => ({ ...r, fieldChanges: [] }));

  const changes = await db
    .select()
    .from(auditRowChanges)
    .where(and(inArray(auditRowChanges.txid, txids)));

  return rows.map((r) => {
    const table = ENTITY_TABLE[r.entityType];
    const fieldChanges = changes
      .filter((c) => c.txid === r.txid && c.rowId === r.entityId && (!table || c.tableName === table))
      .map((c) => ({ table: c.tableName, op: c.op, changes: c.changes }));
    return { ...r, fieldChanges };
  });
}
