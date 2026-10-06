/**
 * Resolves a notification to a page the caller can already open.
 * A missing record or a failed permission check returns unavailable and no path.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";

interface TargetRule {
  resource: ResourceKey;
  table: string | null;
  path: (id: number) => string;
}

const RULES: Record<string, TargetRule> = {
  ncr: { resource: "ncr", table: "ncr", path: (id) => `/ncr/${id}#record-current-step` },
  NCR: { resource: "ncr", table: "ncr", path: (id) => `/ncr/${id}#record-current-step` },
  capa: { resource: "capa", table: "capa", path: (id) => `/capa/${id}#record-current-step` },
  CAPA: { resource: "capa", table: "capa", path: (id) => `/capa/${id}#record-current-step` },
  "8D": { resource: "eight_d", table: "eight_d", path: (id) => `/8d/${id}#record-current-step` },
  EightD: { resource: "eight_d", table: "eight_d", path: (id) => `/8d/${id}#record-current-step` },
  document: { resource: "documents", table: "documents", path: (id) => `/documents/${id}#record-current-step` },
  Document: { resource: "documents", table: "documents", path: (id) => `/documents/${id}#record-current-step` },
  DocumentVersion: { resource: "documents", table: "documents", path: (id) => `/documents/${id}#record-current-step` },
  training: { resource: "training", table: "training_courses", path: (id) => `/training/${id}` },
  TrainingCourse: { resource: "training", table: "training_courses", path: (id) => `/training/${id}` },
  audit: { resource: "audit", table: "audits", path: (id) => `/audits/${id}` },
  Audit: { resource: "audit", table: "audits", path: (id) => `/audits/${id}` },
  Equipment: { resource: "calibration", table: "equipment", path: (id) => `/calibration/${id}` },
  Quarantine: { resource: "quarantine", table: "quarantine_records", path: (id) => `/quarantine/${id}` },
  Rma: { resource: "rma", table: "rma", path: (id) => `/rma/${id}` },
  Supplier: { resource: "suppliers", table: "suppliers", path: (id) => `/suppliers/${id}` },
  InventoryItem: { resource: "inventory", table: "inventory_items", path: (id) => `/inventory/${id}` },
  FaiRecord: { resource: "fai", table: "fai_records", path: (id) => `/fai/records/${id}#record-current-step` },
  FaiSource: { resource: "fai", table: "fai_source_approvals", path: () => "/fai/sources" },
  Validation: { resource: "documents", table: "validation_reports", path: (id) => `/validation-reports/${id}#record-current-step` },
  ChangeRequest: { resource: "change", table: "change_requests", path: (id) => `/change/${id}#record-current-step` },
  FeasibilityReview: { resource: "feasibility", table: "feasibility_reviews", path: (id) => `/feasibility/${id}` },
  SupplierNcrRequest: { resource: "supplier_portal", table: "supplier_rma_requests", path: () => "/supplier-portal?tab=ncr_request" },
  WorkflowVersion: { resource: "workflow", table: "workflow_definitions", path: (id) => `/workflow/${id}` },
  ManagementReviewVersion: { resource: "management_review", table: null, path: () => "/management-system/management-review" },
  ContextVersion: { resource: "context_of_org", table: null, path: () => "/management-system/context" },
  ReportSchedule: { resource: "documents", table: "report_schedules", path: () => "/reporting" },
};

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table name "${name}"`);
  return `"${name}"`;
}

async function rowExists(db: Db, table: string, id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id < 1) return false;
  const found = await db.execute(sql.raw(`SELECT id FROM ${ident(table)} WHERE id = ${id} LIMIT 1`));
  const row = found.rows?.[0] as { id?: number } | undefined;
  return row?.id != null;
}

export type NotificationOpenResult = { status: "open"; path: string } | { status: "none" } | { status: "unavailable" };

/** Path for a known record, including the step anchor. Null when this type has no page. */
export function notificationOpenPath(entityType: string, entityId: number): string | null {
  const found = RULES[entityType];
  if (!found) return null;
  return found.path(entityId);
}

export async function resolveNotificationTarget(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  entityType: string | null,
  entityId: number | null,
): Promise<NotificationOpenResult> {
  if (!entityType || entityId == null) return { status: "none" };
  const found = RULES[entityType];
  if (!found) return { status: "unavailable" };
  const level = await getUserAccessLevel(db, user, found.resource);
  if (level === "none") return { status: "unavailable" };
  if (found.table && !(await rowExists(db, found.table, entityId))) return { status: "unavailable" };
  return { status: "open", path: notificationOpenPath(entityType, entityId)! };
}
