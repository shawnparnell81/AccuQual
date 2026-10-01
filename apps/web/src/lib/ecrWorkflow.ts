/** Mirrors the API stage names. Actions come from the server. */

export const ECR_IMPLEMENT_CELLS = ["B31", "D31", "F31"] as const;

export const ECR_STATUS_LABEL: Record<string, string> = {
  request: "Request",
  review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  implement: "Implementation",
  closed: "Closed",
};

export const ECR_ACTION_LABEL: Record<string, string> = {
  submit: "Submit for review",
  engineering_review: "Engineering review complete",
  quality_review: "Quality review complete",
  approve: "Approve",
  reject: "Reject",
  implement: "Start implementation",
  close: "Close",
  reopen: "Return to request",
};

export type EcrEditing = "all" | "implementation" | "none";

export interface EcrWorkflowView {
  workflow: {
    status: string;
    engineeringReview: { at: string; by: string } | null;
    qualityReview: { at: string; by: string } | null;
  };
  editing: EcrEditing;
  actions: string[];
  blockers: string[];
  labels: Record<string, string>;
  labelsFrozen: boolean;
  revision: string;
  templateRevision: string;
  templateVersion: number;
  lastChange: { who: string; what: string; when: string; description: string } | null;
}

export function ecrCellLocked(editing: EcrEditing, canEdit: boolean, addr: string): boolean {
  if (!canEdit || editing === "none") return true;
  if (editing === "implementation") return !(ECR_IMPLEMENT_CELLS as readonly string[]).includes(addr);
  return false;
}

export function ecrStatusLabel(status: string | undefined): string {
  if (!status) return "Request";
  return ECR_STATUS_LABEL[status] ?? status;
}
