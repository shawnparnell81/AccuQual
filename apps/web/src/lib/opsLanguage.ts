/**
 * Plain-ops copy and the small derivations the home screen and record
 * strips share. Status words stay tied to the real enums (ncr.ts, capa.ts,
 * documents.ts). Nothing here invents a field the API doesn't store.
 */

export type HomeKind = "lead" | "auditor" | "floor";

const ROLE_PHRASES: Record<string, string> = {
  platform_admin: "Platform admin",
  admin: "Administrator",
  quality_manager: "Quality lead",
  auditor: "Auditor",
  operator: "Operator",
  supplier: "Supplier",
  customer: "Customer",
};

const DEPARTMENT_PHRASES: Record<string, string> = {
  quality: "Quality",
  engineering: "Engineering",
  production: "Production",
  customer_service: "Customer service",
  purchasing: "Purchasing",
  material_management: "Material",
  sales_and_marketing: "Sales",
};

/** Everyday nav labels. `standard` is the ISO/IATF term, shown smaller beside the plain name. */
export const PRIMARY_NAV: { key: string; label: string; standard?: string }[] = [
  { key: "ncr", label: "Issues", standard: "NCR" },
  { key: "capa", label: "Fixes", standard: "CAPA" },
  { key: "documents", label: "Documents" },
  { key: "training", label: "Training" },
  { key: "audit", label: "Audits" },
];

export const PRIMARY_NAV_KEYS = new Set(PRIMARY_NAV.map((item) => item.key));

const NAV_PLAIN: Record<string, { label: string; standard?: string }> = {
  ncr: { label: "Issues", standard: "NCR" },
  capa: { label: "Fixes", standard: "CAPA" },
  "8d": { label: "8D reports", standard: "8D" },
  di: { label: "Discrepancies", standard: "DI" },
  audit: { label: "Audits" },
  calibration: { label: "Gages", standard: "Calibration" },
  quarantine: { label: "Holds", standard: "Quarantine" },
  pareto: { label: "Top problems", standard: "Pareto" },
  documents: { label: "Documents", standard: "Document control" },
  general_uploads: { label: "My uploads" },
  training: { label: "Training" },
  worker_profile: { label: "People" },
  reporting: { label: "Reports" },
  change: { label: "Process changes" },
  document_change_requests: { label: "Doc changes" },
  qms_forms: { label: "Forms" },
  scar_forms: { label: "Supplier fixes", standard: "SCAR" },
  quality_inspection_reports: { label: "Inspections" },
  risk: { label: "Risks", standard: "FMEA" },
  mgmt_system: { label: "Management system" },
  workflow: { label: "Workflow builder" },
  ai: { label: "AI insights" },
  digital_twin: { label: "Digital twin" },
  onboarding: { label: "Setup" },
  admin_console: { label: "Admin" },
  complaints: { label: "Complaints" },
  suppliers: { label: "Suppliers" },
  inventory: { label: "Inventory" },
  erp: { label: "Purchase orders" },
  rma: { label: "Returns", standard: "RMA" },
  work_orders: { label: "Work orders" },
  purchase_requisitions: { label: "Purchase requests" },
  warranty: { label: "Warranty" },
  supplier_portal: { label: "Supplier portal" },
  crar: { label: "Return analysis", standard: "CRAR" },
  rma_log: { label: "Return log" },
  rma_activity_log: { label: "Return activity" },
  production_log: { label: "Production log" },
  sales_accounts: { label: "Accounts" },
  customers: { label: "New customers" },
  ppap: { label: "PPAP / APQP" },
  feasibility: { label: "Feasibility" },
};

const STATUS_PHRASE: Record<string, string> = {
  open: "Open",
  contained: "Contained",
  investigating: "Looking into it",
  corrective_action: "Fix in progress",
  closed: "Closed",
  in_progress: "In progress",
  verifying: "Checking the fix",
  draft: "Draft",
  in_review: "In review",
  approved: "Released",
  obsolete: "Retired",
  scheduled: "Scheduled",
  completed: "Done",
  overdue: "Late",
  assigned: "Assigned",
  active: "Active",
};

export const NCR_LOOP = ["Contain", "Disposition", "Fix", "Check it"] as const;
export const CAPA_LOOP = ["Start", "Do the fix", "Check it"] as const;
export const DOC_LOOP = ["Draft", "Review", "Release", "Train"] as const;

export const READ_ONLY_REASON = "You can view this. Your department can't change it.";
export const UNASSIGNED_PLANT_REASON = "You aren't assigned to a plant, so you can't add or change records here.";
export const DOC_EDIT_REASON = "Editing a draft is limited to quality, engineering, and reviewers.";
export const TRAINING_MANAGE_REASON = "Assigning training is limited to quality and reviewers.";

export function homeKind(roleName: string | null | undefined): HomeKind {
  if (roleName === "quality_manager" || roleName === "admin") return "lead";
  if (roleName === "auditor") return "auditor";
  return "floor";
}

export function rolePhrase(roleName: string | null | undefined): string {
  if (!roleName) return "";
  return ROLE_PHRASES[roleName] ?? roleName.replace(/_/g, " ");
}

export function departmentPhrase(department: string | null | undefined): string {
  if (!department) return "";
  return DEPARTMENT_PHRASES[department] ?? department.replace(/_/g, " ");
}

export function plainNav(key: string, fallback: string): { label: string; standard?: string } {
  return NAV_PLAIN[key] ?? { label: fallback };
}

export function navSearchText(key: string, label: string): string {
  const plain = plainNav(key, label);
  return `${label} ${plain.label} ${plain.standard ?? ""}`.toLowerCase();
}

export function statusPhrase(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_PHRASE[value] ?? value.replace(/_/g, " ");
}

export function personLabel(
  people: { id: number; name: string | null; email: string }[] | undefined,
  id: number | null | undefined
): string {
  if (id == null) return "Unassigned";
  const person = people?.find((p) => p.id === id);
  if (!person) return "Assigned";
  const name = person.name?.trim();
  return name || person.email;
}

/** `due` is an ISO timestamp. Comparison is the calendar day, matching the date inputs that write UTC midnight. */
export function isPastDue(due: string | null | undefined, terminal: boolean, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!due || terminal) return false;
  return due.slice(0, 10) < today;
}

export function duePhrase(due: string | null | undefined, terminal: boolean, today?: string): string {
  if (!due) return "No due date";
  const day = due.slice(0, 10);
  if (isPastDue(due, terminal, today)) return `Late · ${day}`;
  return day;
}

export function ncrLoopIndex(status: "open" | "contained" | "investigating" | "corrective_action" | "closed"): number {
  switch (status) {
    case "open":
      return 0;
    case "contained":
      return 1;
    case "investigating":
      return 2;
    case "corrective_action":
      return 3;
    case "closed":
      return 4;
  }
}

export function ncrNextAction(status: "open" | "contained" | "investigating" | "corrective_action" | "closed", hasFix: boolean): string {
  switch (status) {
    case "open":
      return "Contain it and decide what happens to the parts.";
    case "contained":
      return "Write the cause, then open a fix.";
    case "investigating":
      return hasFix ? "Write the corrective action on this issue." : "Open a fix so this doesn't stop at containment.";
    case "corrective_action":
      return "Check the fix, then close this issue.";
    case "closed":
      return "Nothing left on this issue.";
  }
}

export function capaLoopIndex(status: "open" | "in_progress" | "verifying" | "closed"): number {
  switch (status) {
    case "open":
      return 0;
    case "in_progress":
      return 1;
    case "verifying":
      return 2;
    case "closed":
      return 3;
  }
}

export function capaNextAction(status: "open" | "in_progress" | "verifying" | "closed"): string {
  switch (status) {
    case "open":
      return "Start the work on this fix.";
    case "in_progress":
      return "Record whether the fix worked.";
    case "verifying":
      return "Close it if the fix held.";
    case "closed":
      return "Nothing left on this fix.";
  }
}

export function documentLoop(status: "draft" | "in_review" | "approved" | "obsolete", hasTraining: boolean): { index: number; next: string } {
  switch (status) {
    case "draft":
      return { index: 0, next: "Finish the draft and send it for review." };
    case "in_review":
      return { index: 1, next: "A reviewer needs to approve this or send it back." };
    case "approved":
      return hasTraining
        ? { index: 3, next: "Open training and mark people complete on this revision." }
        : { index: 3, next: "Assign training so people learn this revision." };
    case "obsolete":
      return { index: 4, next: "This document is retired." };
  }
}

export interface LateItem {
  who: string;
  label: string;
  link: string;
  due: string;
}

export function lateItems(
  rows: { who: string; label: string; link: string; due: string | null; terminal: boolean }[],
  today?: string
): LateItem[] {
  return rows
    .filter((row) => isPastDue(row.due, row.terminal, today))
    .map((row) => ({ who: row.who, label: row.label, link: row.link, due: row.due!.slice(0, 10) }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
}

const RECORD_BASE: Record<string, string> = {
  ncr: "/ncr",
  NCR: "/ncr",
  capa: "/capa",
  CAPA: "/capa",
  document: "/documents",
  Document: "/documents",
  DocumentVersion: "/documents",
  training: "/training",
  TrainingCourse: "/training",
  audit: "/audits",
  Audit: "/audits",
  Equipment: "/calibration",
  Quarantine: "/quarantine",
  Rma: "/rma",
  Supplier: "/suppliers",
  InventoryItem: "/inventory",
};

/** In-app path for a notification's related record. Null when the type has no stable page. */
export function recordPath(entityType: string | null | undefined, entityId: number | null | undefined): string | null {
  if (!entityType || entityId == null || !Number.isFinite(entityId)) return null;
  const base = RECORD_BASE[entityType];
  if (!base) return null;
  return `${base}/${entityId}`;
}
