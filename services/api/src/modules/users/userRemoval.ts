import { isFullAccessRole } from "../roles/roleAccess.js";

export interface HistoryHit {
  label: string;
  count: number;
}

export type UserRemovalDecision =
  | { outcome: "blocked"; status: number; message: string }
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
  const history = input.history.filter((hit) => hit.count > 0);
  if (history.length === 0) {
    return { outcome: "deleted", message: "The account was removed. They had no quality records." };
  }
  const listed = history
    .slice(0, 6)
    .map((hit) => `${hit.count} ${hit.label}`)
    .join(", ");
  return {
    outcome: "deactivated",
    message: `This person has records tied to them (${listed}), so the account was turned off instead of erased. Their name stays on those records, and they can no longer sign in.`,
  };
}
