import { isFullAccessRole } from "../roles/roleAccess.js";

export interface HistoryHit {
  label: string;
  count: number;
}

export type UserRemovalDecision =
  | { outcome: "blocked"; status: number; message: string; requiresReplacement?: boolean }
  | { outcome: "deleted"; message: string }
  | { outcome: "deactivated"; message: string };

/** Session and membership rows removed with an account that has no quality history. */
export const REMOVABLE_USER_LINK_TABLES = new Set([
  "refresh_tokens",
  "trusted_devices",
  "mfa_recovery_codes",
  "password_reset_tokens",
  "user_identities",
  "user_permission_roles",
  "user_sites",
]);

const HISTORY_LABELS: Record<string, string> = {
  ncr: "NCRs",
  capa: "CAPAs",
  eight_d: "8D reports",
  documents: "documents",
  document_versions: "document approvals",
  document_files: "documents",
  audit_trail: "audit log entries",
  controlled_versions: "approvals",
  change_requests: "approvals",
  calibrations: "calibrations",
  quality_inspection_reports: "inspections",
  supplier_scorecards: "supplier scorecards",
};

export function historyLabel(table: string): string {
  return HISTORY_LABELS[table] ?? table.replace(/_/g, " ");
}

/** Plural labels the removal message uses, and the singular form of each. */
const SINGULAR_LABELS: Record<string, string> = {
  "open NCRs": "open NCR",
  "open CAPAs": "open CAPA",
  "open 8D reports": "open 8D report",
  "documents in draft or review": "document in draft or review",
  "reviews waiting on them": "review waiting on them",
  "people who report to them": "person who reports to them",
  "open complaints": "open complaint",
  "open investigations": "open investigation",
  "training assignments": "training assignment",
  "open risks": "open risk",
  "risk actions": "risk action",
  "open audits": "open audit",
  "feasibility reviews": "feasibility review",
  "PPAP packages": "PPAP package",
  "competency evaluations": "competency evaluation",
  NCRs: "NCR",
  CAPAs: "CAPA",
  "8D reports": "8D report",
  documents: "document",
  "document approvals": "document approval",
  "audit log entries": "audit log entry",
  approvals: "approval",
  calibrations: "calibration",
  inspections: "inspection",
  "supplier scorecards": "supplier scorecard",
};

export function quantityPhrase(count: number, label: string): string {
  const word = count === 1 ? (SINGULAR_LABELS[label] ?? label) : label;
  return `${count} ${word}`;
}

/** Collapse per-table hits into plain labels for the confirmation message. */
export function summarizeHistory(hits: { table: string; count: number }[]): HistoryHit[] {
  const totals = new Map<string, number>();
  for (const hit of hits) {
    if (hit.count <= 0) continue;
    const label = historyLabel(hit.table);
    totals.set(label, (totals.get(label) ?? 0) + hit.count);
  }
  return [...totals.entries()].map(([label, count]) => ({ label, count }));
}

export function decideUserRemoval(input: {
  actorId: number;
  targetId: number;
  targetRoleName: string | null;
  otherActiveFullAccess: number;
  history: HistoryHit[];
  openWork?: HistoryHit[];
  hasReplacement?: boolean;
}): UserRemovalDecision {
  if (input.actorId === input.targetId) {
    return { outcome: "blocked", status: 409, message: "You can't delete your own account." };
  }
  if (isFullAccessRole(input.targetRoleName) && input.otherActiveFullAccess < 1) {
    return {
      outcome: "blocked",
      status: 409,
      message: "This is the last Owner or Administrator. Give that access to someone else first.",
    };
  }
  const openWork = (input.openWork ?? []).filter((hit) => hit.count > 0);
  if (openWork.length > 0 && !input.hasReplacement) {
    const listed = openWork
      .slice(0, 6)
      .map((hit) => quantityPhrase(hit.count, hit.label))
      .join(", ");
    return {
      outcome: "blocked",
      status: 409,
      requiresReplacement: true,
      message: `This person still has open work (${listed}). Choose someone to take it before removing them.`,
    };
  }
  const history = input.history.filter((hit) => hit.count > 0);
  if (history.length === 0) {
    return { outcome: "deleted", message: "The account was removed. They had no quality records." };
  }
  const listed = history
    .slice(0, 6)
    .map((hit) => quantityPhrase(hit.count, hit.label))
    .join(", ");
  return {
    outcome: "deactivated",
    message: `This person has records tied to them (${listed}), so the account was turned off instead of erased. Their name stays on those records, and they can no longer sign in.`,
  };
}
