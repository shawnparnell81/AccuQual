/** GET/POST/PATCH /users (services/api's users.controller.ts) — never includes passwordHash. */
export interface AppUser {
  id: number;
  email: string;
  name: string | null;
  roleId: number | null;
  department: string | null;
  isActive: boolean;
  createdAt: string;
}

/** GET/POST/PATCH /roles — platform-wide constants, not tenant-scoped (see roles.controller.ts). */
export interface AppRole {
  id: number;
  name: string;
  description: string | null;
}

/**
 * One row from GET /workflow/history/:moduleName/:recordId (see
 * workflow.controller.ts's historyHandler) — a raw audit_trail row.
 * `action` is the fixed DB-shaped category (create/update/delete/
 * status_change/transition_failed, see the Audit Trail Dictionary); the
 * specific transition name (e.g. "close", "approve") usually lives inside
 * `changes.action` instead, when the writer curated one.
 */
export interface WorkflowHistoryEntry {
  id: number;
  tenantId: number;
  entityType: string;
  entityId: number;
  action: "create" | "update" | "delete" | "status_change" | "transition_failed";
  changes: Record<string, unknown> | null;
  performedBy: number | null;
  createdAt: string;
}

/** Friendly moduleName values the history endpoint accepts — kept in sync with services/api's workflow.controller.ts MODULE_ENTITY_TYPES. */
export type WorkflowModuleName = "calibration" | "documents" | "training" | "audit" | "ncr" | "capa" | "di" | "suppliers" | "inventory";

export interface Ncr {
  id: number;
  title: string;
  description: string | null;
  status: "open" | "contained" | "investigating" | "corrective_action" | "closed";
  severity: "low" | "medium" | "high" | "critical" | null;
  containment: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  assignedTo: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Real column (ncr.ts), just never surfaced on the frontend until the dashboard needed it for a closure trend. */
  closedAt: string | null;
}

export interface Capa {
  id: number;
  ncrId: number | null;
  rootCause: string | null;
  actionPlan: string | null;
  preventiveAction: string | null;
  verification: string | null;
  status: "open" | "in_progress" | "verifying" | "closed";
  ownerId: number | null;
  createdAt: string;
  /** Real column (capa.ts), same reason as Ncr.closedAt above. */
  closedAt: string | null;
}

export interface AuditItem {
  id: number;
  auditId: number;
  question: string;
  finding: string | null;
  severity: "observation" | "minor" | "major" | "critical" | null;
  evidence: string | null;
}

export interface Audit {
  id: number;
  name: string;
  type: string | null;
  status: "scheduled" | "in_progress" | "completed";
  auditorId: number | null;
  scheduledAt: string | null;
  completedAt: string | null;
}

export interface AccuQualDocument {
  id: number;
  title: string;
  category: string | null;
  currentVersion: number;
  status: "draft" | "in_review" | "approved" | "obsolete";
  ownerId: number | null;
  expirationDate: string | null;
  expirationWarningDays: number;
  retentionPeriodDays: number;
  retentionAction: "archive" | "delete";
  retentionState: "active" | "archived";
  /** Real column, set on every write (approve/revise/archive) — used as an activity-by-month proxy since there's no bulk revision-history endpoint. */
  updatedAt: string | null;
}

export interface TrainingCourse {
  id: number;
  title: string;
  description: string | null;
  requiredForRoleId: number | null;
  documentId: number | null;
}

export interface TrainingAssignment {
  id: number;
  courseId: number;
  userId: number;
  status: "assigned" | "in_progress" | "completed" | "overdue";
  dueAt: string | null;
  completedAt: string | null;
  trainerName: string | null;
  notes: string | null;
  certificatePath: string | null;
  userEmail?: string | null;
  userName?: string | null;
  courseTitle?: string | null;
  documentId?: number | null;
}

export interface DocumentVersion {
  id: number;
  documentId: number;
  version: number;
  fileUrl: string | null;
  changeNotes: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  contactEmail: string | null;
  status: "active" | "probation" | "suspended" | "disqualified";
  riskLevel: string | null;
}

export interface InventoryStock {
  id: number;
  itemId: number;
  location: string;
  onHand: string;
  allocated: string;
  onOrder: string;
  lastAdjustedAt: string | null;
  lastAdjustedBy: number | null;
}

export interface InventoryItem {
  id: number;
  sku: string;
  description: string | null;
  itemType: "raw_material" | "wip" | "finished_good";
  unitOfMeasure: string | null;
  defaultSupplierId: number | null;
  minLevel: string;
  maxLevel: string | null;
  reorderQuantity: string | null;
  leadTimeDays: number | null;
  state: "in_stock" | "below_min" | "reorder_pending" | "on_order" | "overstock" | "inactive";
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** Only on GET /inventory/items (listItemsHandler) — the summed on_hand across all locations. */
  onHand?: number;
  /** Only on GET /inventory/items/:id (getItemHandler) — the real per-location rows. */
  stock?: InventoryStock[];
}

export interface InventoryMovement {
  id: number;
  itemId: number;
  movementType: "receive" | "consume" | "produce" | "adjust" | "scrap" | "transfer";
  quantity: string;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string | null;
  performedBy: number | null;
  performedAt: string;
}

export interface InventoryAlert {
  id: number;
  itemId: number;
  alertType: "below_min" | "overstock";
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: number | null;
  sku: string;
  description: string | null;
  itemType: "raw_material" | "wip" | "finished_good";
  minLevel: string;
  reorderQuantity: string | null;
  currentStock: number;
}

/** GET /inventory/alerts/routing — real active-user counts per department, not a fictional single "department email" (see the Alerts UI review). */
export interface InventoryAlertRouting {
  material_management: number;
  purchasing: number;
}

export interface AiSuggestion {
  id: number;
  module: string | null;
  pipeline: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  confidence: string | null;
  createdAt: string;
}

export interface DigitalTwinModel {
  id: number;
  name: string;
  description: string | null;
  modelJson: { nodes: unknown[]; edges: unknown[] };
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  module: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
}
