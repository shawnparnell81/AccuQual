import type { TenantDb } from "../../lib/tenantScope.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { logger } from "../../utils/logger.js";

interface RecordAuditTrailInput {
  tenantId: number;
  entityType: string;
  entityId: number;
  action: "create" | "update" | "delete" | "status_change";
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
