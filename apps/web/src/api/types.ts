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
export type WorkflowModuleName = "calibration" | "documents" | "training" | "audit" | "ncr" | "capa" | "di" | "suppliers" | "inventory" | "erp" | "rma" | "work_orders" | "risk" | "feasibility" | "sales_accounts" | "customers" | "document_change_requests" | "qms_forms" | "scar_forms" | "quality_inspection_reports";

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

/**
 * GET /suppliers/:id/performance and /suppliers/performance-summary — built
 * entirely from real inventory_movements/inventory_reorder_requests/
 * inventory_alerts rows (see supplier.performance.ts). Delivery timeliness/
 * accuracy sampleSize can be 0 (avgDays/avgPercent then null) — nothing
 * formally links a reorder request to the movement that fulfilled it, so
 * a supplier with no matched pairs yet has no fabricated average.
 */
export interface SupplierPerformance {
  supplierId: number;
  supplierName?: string; // only on the performance-summary list, not the single-supplier endpoint
  itemCount: number;
  deliveryFrequency: { count: number; days: number };
  deliveryTimeliness: { avgDays: number | null; sampleSize: number };
  deliveryAccuracy: { avgPercent: number | null; sampleSize: number };
  reorderResponsiveness: { overduePendingCount: number; thresholdDays: number };
  belowMinAlertCount: number;
  riskScore: "low" | "medium" | "high" | "no_data";
  riskPoints: number;
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
  /** Nullable — no fabricated default cost; see inventory.costing.ts. */
  unitCost: string | null;
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
  /** Free-form manual tags — no Production Work Order module exists to set these automatically. */
  referenceType: string | null;
  referenceId: string | null;
  performedBy: number | null;
  performedAt: string;
}

export interface MovementTrendPoint {
  bucket: string;
  receive: number;
  consume: number;
  produce: number;
  adjust: number;
  scrap: number;
  transfer: number;
}
export interface MovementTrendsResponse {
  bucket: "day" | "week";
  days: number;
  data: MovementTrendPoint[];
}

export interface ConsumptionVsReceivingPoint {
  bucket: string;
  consumed: number;
  received: number;
}
export interface ConsumptionVsReceivingResponse {
  bucket: "day" | "week";
  days: number;
  data: ConsumptionVsReceivingPoint[];
}

export interface ScrapAnalytics {
  byItem: { itemId: number; sku: string; quantity: number }[];
  byReferenceType: { referenceType: string; quantity: number }[];
}

export interface ReferenceSummaryEntry {
  referenceType: string | null;
  count: number;
  quantity: number;
}

/** GET /inventory/costing/:itemId — null fields mean the item has no unitCost set, not a $0 value. */
export interface ItemCosting {
  itemId: number;
  sku: string;
  unitCost: number | null;
  onHand: number;
  itemValue: number | null;
  scrapCost: number | null;
  consumptionCost: number | null;
  days: number;
}

export interface SupplierCostEntry {
  supplierId: number;
  supplierName: string;
  itemValue: number;
  scrapCost: number;
  consumptionCost: number;
  itemCount: number;
}

/** GET /inventory/costing/summary — current unitCost only, no FIFO/LIFO cost layers exist. */
export interface CostingSummary {
  totalInventoryValue: number;
  uncostedItemCount: number;
  totalScrapCost: number;
  totalConsumptionCost: number;
  supplierCostDistribution: SupplierCostEntry[];
  days: number;
}

/** A real, standalone ERP module — no external ERP integration, no automatic inventory movements. See erp.service.ts. */
export type PurchaseOrderStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

export interface ErpPoLineItem {
  id: number;
  purchaseOrderId: number;
  itemId: number;
  quantity: number;
  unitCost: string | null;
  notes: string | null;
  sku: string | null;
  description: string | null;
  /** Real sum across every receiving document filed against this line — not a guess. */
  quantityReceived: number;
}

export interface ErpPurchaseOrder {
  id: number;
  supplierId: number;
  supplierName?: string; // only on the list endpoint
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  lineItems?: ErpPoLineItem[]; // only on the single-PO endpoint
}

export interface ErpReceivingLineItem {
  id: number;
  receivingDocumentId: number;
  poLineItemId: number;
  quantityReceived: number;
  notes: string | null;
}

export interface ErpReceivingDocument {
  id: number;
  purchaseOrderId: number;
  createdBy: number | null;
  createdAt: string;
  notes: string | null;
  lineItems?: ErpReceivingLineItem[];
}

export interface ErpOverview {
  countByStatus: Record<PurchaseOrderStatus, number>;
  recent: { id: number; status: PurchaseOrderStatus; supplierName: string; createdAt: string }[];
}

export type RmaStatus = "draft" | "submitted_to_supplier" | "approved_by_supplier" | "in_transit" | "received_by_supplier" | "closed" | "cancelled";
export type RmaReasonCode = "defective" | "wrong_item" | "over_shipment" | "under_shipment" | "quality_issue" | "other";

export interface RmaItem {
  id: number;
  rmaId: number;
  itemId: number;
  sku?: string | null; // joined, list/detail endpoints only
  description: string | null;
  quantityReturned: string;
  unitOfMeasure: string | null;
  reason: string | null;
  supplierResponse: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Rma {
  id: number;
  rmaNumber: string;
  status: RmaStatus;
  supplierId: number;
  supplierName?: string; // list endpoint only
  reasonCode: RmaReasonCode | null;
  linkedNcrId: number | null;
  linkedCapaId: number | null;
  createdByUserId: number | null;
  approvedByUserId: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only — read-only summaries, see the RMA module's
  // Supplier/NCR/CAPA integration points.
  supplier?: { id: number; name: string; contactEmail: string | null; status: string };
  linkedNcr?: { id: number; title: string; status: string; severity: string | null } | null;
  linkedCapa?: { id: number; status: string; rootCause: string | null } | null;
  items?: RmaItem[];
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

/** A minimal ERP reorder stub — created only when Purchasing marks an item reorder_pending, never by an external ERP (none exists). */
export interface InventoryReorderRequest {
  id: number;
  itemId: number;
  requestedQty: number;
  status: "pending" | "sent" | "ignored";
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
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

export interface TwinNode {
  id: string;
  name: string;
  type: "machine" | "process" | "checkpoint" | "operator";
  baseDefectRate?: number;
  throughputPerHour?: number;
}

export interface DigitalTwinModel {
  id: number;
  name: string;
  description: string | null;
  modelJson: { nodes: TwinNode[]; edges: { from: string; to: string }[] };
}

export interface DigitalTwinSimulation {
  id: number;
  modelId: number;
  inputParameters: Record<string, unknown> | null;
  results: Record<string, unknown> | null;
}

export interface IotDevice {
  id: number;
  deviceId: string;
  name: string | null;
  type: "plc" | "sensor" | "inspection_equipment" | "environmental" | null;
  digitalTwinModelId: number | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/** GET/PATCH /tenant/branding — real tenants.branding jsonb field. */
export interface TenantBranding {
  logoUrl?: string;
  primaryColor?: string;
  pdfHeader?: string;
  pdfFooter?: string;
  // Theme colors — same object, see tenants.branding's schema comment.
  secondaryColor?: string;
  accentColor?: string;
  backgroundLight?: string;
  backgroundDark?: string;
  textLight?: string;
  textDark?: string;
  formFieldColor?: string;
  buttonColor?: string;
  borderColor?: string;
}

/** GET/PATCH /users/me/theme — any authenticated user, own row only. Unset fields mean "follow the tenant/default theme" for that field specifically, not an all-or-nothing override. */
export interface UserThemePreferences {
  mode?: "light" | "dark" | "system";
  primaryColor?: string;
  accentColor?: string;
}

/** GET/PATCH /tenant/ai-config (admin only) — apiKey is never returned; maskedApiKey/hasApiKey only. Now live: the AI Assistant proxy (POST /ai/assistant) and the AI pipelines use this config's provider/key/model when set, falling back to the global env config otherwise. */
export interface TenantAiConfig {
  provider: "anthropic" | "openai" | null;
  modelName: string | null;
  temperature: number | null;
  maxTokens: number | null;
  hasApiKey: boolean;
  maskedApiKey?: string | null;
  assistantName: string | null;
  // BYOK usage limit — see tenants.aiMonthlyLimit's schema comment for why
  // enforcement itself is computed live from audit trail history, not a
  // stored counter.
  monthlyLimit: number | null;
  limitEnforced: boolean;
}

/** GET /tenant/ai-usage (admin only). dailyBreakdown/moduleBreakdown cover the last 30 days; totalTokens/totalCost are all-time. remainingTokens is null when no limit is enforced. */
export interface TenantAiUsage {
  totalTokens: number;
  totalCost: number;
  monthlyLimit: number | null;
  limitEnforced: boolean;
  currentMonthTokens: number;
  remainingTokens: number | null;
  dailyBreakdown: Array<{ label: string; count: number }>;
  moduleBreakdown: Array<{ module: string; tokens: number; calls: number }>;
}

/** GET /tenant/assistant-name — open to ANY authenticated user (not just admin), so the floating Assistant panel can label itself for everyone. */
export interface AssistantNameResponse {
  assistantName: string | null;
}

/** POST /ai/assistant response. usage is null when the provider didn't report token counts (including the honest no-API-key stub). */
export interface AssistantReply {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/** GET /search?q=... — one row per real match across NCR/CAPA/PO/Audit/Supplier/Item/Training/Calibration. "WO" is a reserved type never actually returned yet — see search.controller.ts. */
export interface SearchResult {
  type: "NCR" | "CAPA" | "PO" | "WO" | "Audit" | "Supplier" | "Item" | "Training" | "Calibration";
  id: number;
  label: string;
  path: string;
}

/** GET /forms/templates — one entry per real form type (see forms.validation.ts's FORM_TYPES). */
export interface FormTemplateStatus {
  formType: string;
  hasTemplate: boolean;
  isDefault: boolean | null;
  uploadedAt: string | null;
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  module: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
}

export type WorkOrderStatus = "planned" | "in_progress" | "completed" | "cancelled";

/** One row of the Production Work Order traveler's Operations Routing table — see workOrders.ts's schema comment. */
export interface WorkOrderOperation {
  id: number;
  workOrderId: number;
  opNumber: number;
  description: string;
  workCenter: string | null;
  completedQty: string | null;
  signOff: string | null;
  signOffDate: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface WorkOrder {
  id: number;
  itemId: number;
  sku?: string; // list endpoint only
  description?: string | null; // list endpoint only
  quantityPlanned: string;
  quantityCompleted: string;
  status: WorkOrderStatus;
  linkedNcrId: number | null;
  dueDate: string | null;
  notes: string | null;
  revision: string | null;
  firstPieceInspectionPassed: boolean;
  finalQcInspectionPassed: boolean;
  operatorSignature: string | null;
  operatorSignedAt: string | null;
  inspectorSignature: string | null;
  inspectorSignedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  item?: { id: number; sku: string; description: string | null; state: string } | null;
  linkedNcr?: { id: number; title: string; status: string; severity: string | null } | null;
  operations?: WorkOrderOperation[];
}

export type DocumentChangeStatus = "draft" | "active" | "obsolete";

/** One row of the Document Change Request's "Change Request" table — see documentChangeRequests.ts's schema comment. */
export interface DocumentChangeItem {
  id: number;
  documentChangeRequestId: number;
  changeId: string | null;
  documentProcess: string | null;
  currentRevision: string | null;
  proposedRevision: string | null;
  reason: string | null;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** One row of the Document Change Request's "Review & Approval" table. */
export interface DocumentChangeReview {
  id: number;
  documentChangeRequestId: number;
  reviewer: string | null;
  comments: string | null;
  decision: string | null;
  reviewDate: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface DocumentChangeRequest {
  id: number;
  formNo: string | null;
  revision: string | null;
  effectiveDate: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  status: DocumentChangeStatus;
  additionalComments: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  items?: DocumentChangeItem[];
  reviews?: DocumentChangeReview[];
}

export type QmsFormStatus = "draft" | "active" | "obsolete";

/** One row in one named table section of a QmsForm — see qmsFormDefinitions.ts. */
export interface QmsFormRow {
  id: number;
  formId: number;
  sectionKey: string;
  data: Record<string, string>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
}

/** A generic QMS Simple Form record — see qmsForms.ts's schema comment. */
export interface QmsForm {
  id: number;
  formType: string;
  formNo: string | null;
  revision: string | null;
  effectiveDate: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  status: QmsFormStatus;
  additionalComments: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  rows?: QmsFormRow[];
}

export type ScarStatus = "open" | "closed";

/** Supplier Corrective Action Request — see scarForms.ts's schema comment for why the CAPA/sign-off rows are flat columns, not a child table. */
export interface ScarForm {
  id: number;
  scarNumber: string | null;
  dateIssued: string | null;
  supplierName: string | null;
  responseDueDate: string | null;
  contactPerson: string | null;
  poNumber: string | null;
  partNumberDescription: string | null;
  lotHeatNumber: string | null;
  quantityInspected: string | null;
  quantityRejected: string | null;
  defectDescription: string | null;
  quarantineAtSupplier: boolean;
  quarantineInTransit: boolean;
  quarantineAtCustomerSite: boolean;
  containmentPlan: string | null;
  why1: string | null;
  why2: string | null;
  why3: string | null;
  why4: string | null;
  why5: string | null;
  correctiveActionOwner: string | null;
  correctiveActionTargetDate: string | null;
  preventiveActionOwner: string | null;
  preventiveActionTargetDate: string | null;
  processUpdateOwner: string | null;
  processUpdateTargetDate: string | null;
  supplierRepSignature: string | null;
  supplierRepDate: string | null;
  qualityEngineerSignature: string | null;
  qualityEngineerDate: string | null;
  status: ScarStatus;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export type InspectionType = "incoming" | "in_process" | "final";
export type InspectionFinalStatus = "accepted" | "rejected" | "rework_required" | "accepted_via_deviation";
export type InspectionItemResult = "pass" | "fail";

export interface QualityInspectionItem {
  id: number;
  reportId: number;
  itemNumber: string | null;
  parameter: string | null;
  specification: string | null;
  actualFinding: string | null;
  result: InspectionItemResult | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface QualityInspectionReport {
  id: number;
  inspectionDate: string | null;
  inspectorName: string | null;
  inspectionType: InspectionType | null;
  partMaterialNo: string | null;
  poJobNo: string | null;
  supplierVendor: string | null;
  batchLotNo: string | null;
  totalQuantity: string | null;
  sampleSize: string | null;
  finalStatus: InspectionFinalStatus | null;
  notesRemarks: string | null;
  inspectorSignature: string | null;
  inspectorSignatureDate: string | null;
  qaLeadSignature: string | null;
  qaLeadSignatureDate: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  items?: QualityInspectionItem[];
}

export type PurchaseRequisitionStatus = "draft" | "pending_approval" | "approved" | "rejected" | "converted_to_po";

export interface ErpPurchaseRequisition {
  id: number;
  itemId: number;
  sku?: string; // list endpoint only
  quantity: number;
  supplierId: number | null;
  department: string | null;
  linkedNcrId: number | null;
  justification: string | null;
  status: PurchaseRequisitionStatus;
  approvedBy: number | null;
  approvedAt: string | null;
  purchaseOrderId: number | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  item?: { id: number; sku: string; description: string | null } | null;
  supplier?: { id: number; name: string; status: string } | null;
}

export type RiskStatus = "open" | "mitigation" | "monitoring" | "closed";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type MitigationStatus = "planned" | "in_progress" | "completed";

export interface RiskMitigation {
  id: number;
  riskAssessmentId: number;
  action: string;
  dueDate: string | null;
  ownerId: number | null;
  status: MitigationStatus;
  createdAt: string;
  updatedAt: string | null;
}

export interface FmeaItem {
  id: number;
  riskAssessmentId: number;
  failureMode: string;
  effect: string | null;
  cause: string | null;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: string | null;
  recommendedAction: string | null;
}

/** The Risk Register — see risk.ts's own schema comment for how this differs from /ai/risk-score (supplier scoring) and the Digital Twin's simulation heatmap. */
export interface RiskAssessment {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  sourceType: "NCR" | "Supplier" | "Receiving" | "WorkOrder" | "Manual" | null;
  sourceId: number | null;
  severity: number | null;
  probability: number | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  processArea: string | null;
  department: string | null;
  ownerId: number | null;
  status: RiskStatus;
  createdAt: string;
  updatedAt: string | null;
  closedAt: string | null;
  // Detail endpoint only.
  mitigations?: RiskMitigation[];
  fmeaItems?: FmeaItem[];
}

export type FeasibilitySourceType = "ncr" | "supplier" | "complaint" | "ppap" | "change_request" | "work_order" | "requisition" | "po" | "rma" | "customer" | "future_product";
export type FeasibilityStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected";
export type FeasibilityDecision = "feasible" | "conditional" | "not_feasible";

export interface FeasibilityScore {
  id: number;
  feasibilityId: number;
  dimensionKey: string;
  dimensionLabel: string | null;
  dimensionType: string | null;
  value: string;
  weight: string | null;
  contribution: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** The unified Feasibility Review — ONE module across every source type, see feasibility.ts's own schema comment. */
export interface FeasibilityReview {
  id: number;
  title: string;
  description: string | null;
  sourceType: FeasibilitySourceType | null;
  sourceId: number | null;
  overallScore: string | null;
  decision: FeasibilityDecision | null;
  status: FeasibilityStatus;
  department: string | null;
  ownerId: number | null;
  reviewerId: number | null;
  createdAt: string;
  updatedAt: string | null;
  decidedAt: string | null;
  // Detail endpoint only.
  scores?: FeasibilityScore[];
}

export type SalesAccountStatus = "prospect" | "active" | "dormant";
export type SalesQuoteStatus = "draft" | "submitted" | "accepted" | "rejected" | "archived";
export type SalesContractStatus = "draft" | "active" | "expired" | "archived";
export type SalesContractType = "customer" | "service" | "pricing" | "renewal";
export type SalesActivityType = "call" | "meeting" | "email" | "demo" | "follow_up" | "note";
export type SalesRelatedSourceType = "NCR" | "PPAP" | "ChangeRequest" | "WorkOrder" | "Requisition" | "PO" | "RMA";

export interface SalesAccount {
  id: number;
  customerName: string;
  industry: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  status: SalesAccountStatus;
  ownerId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  // Detail endpoint only.
  activities?: SalesActivity[];
  quotes?: SalesQuote[];
  contracts?: SalesContract[];
}

export interface SalesActivity {
  id: number;
  accountId: number;
  activityType: SalesActivityType;
  notes: string | null;
  nextSteps: string | null;
  dueDate: string | null;
  ownerId: number | null;
  relatedSourceType: SalesRelatedSourceType | null;
  relatedSourceId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface SalesQuote {
  id: number;
  accountId: number;
  quoteNumber: string;
  revision: number;
  status: SalesQuoteStatus;
  pricingSheetDocumentId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface SalesContract {
  id: number;
  accountId: number;
  contractType: SalesContractType;
  effectiveDate: string | null;
  expirationDate: string | null;
  status: SalesContractStatus;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export type CustomerType = "OEM" | "Tier 1" | "Tier 2" | "Distributor" | "Other";
export type CustomerStatus = "draft" | "submitted" | "under_review" | "approved" | "activated" | "rejected";
export type CustomerRelatedSourceType = "NCR" | "Supplier" | "WorkOrder" | "Requisition" | "PO" | "RMA" | "Risk" | "Feasibility" | "SalesAccount";

/** A Customer Onboarding case — ONE table for both the master record and its onboarding workflow, see customers.ts's own schema comment. */
export interface Customer {
  id: number;
  legalName: string;
  dbaName: string | null;
  address: string | null;
  billingAddress: string | null;
  website: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  industry: string | null;
  customerType: CustomerType | null;
  status: CustomerStatus;
  department: string | null;
  ownerId: number | null;
  reviewerId: number | null;
  ndaDocumentId: number | null;
  relatedSourceType: CustomerRelatedSourceType | null;
  relatedSourceId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  decidedAt: string | null;
  activatedAt: string | null;
}

export interface OnboardingProgressRow {
  id: number;
  userId: number;
  moduleKey: string;
  status: "not_started" | "in_progress" | "completed";
  updatedAt: string;
}

export interface OnboardingChecklistItem {
  moduleKey: string;
  moduleLabel: string;
  explanation: string;
  firstAction: string;
}

export type ErpAutomationSuggestionType = "create_requisition" | "flag_supplier" | "suggest_inspection";

export interface ErpAutomationSuggestion {
  type: ErpAutomationSuggestionType;
  itemId: number | null;
  supplierId: number | null;
  quantity: number | null;
  rationale: string;
}
