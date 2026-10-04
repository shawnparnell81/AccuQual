import { AppError } from "../../utils/appError.js";

/**
 * Names a blocked workflow move by the fields that are still empty.
 * One message shape for NCR, CAPA, approvals, and simulation.
 */
export function requiredMoveMessage(missing: string[]): string {
  return `Cannot move to the next step. Required fields missing: ${missing.join(", ")}.`;
}

export function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const FIELD_LABELS: Record<string, string> = {
  severity: "Severity",
  disposition: "Disposition",
  review_notes: "Review Notes",
  containment_required: "Containment Required",
  containment: "Containment Action",
  root_cause_method: "Root Cause Method",
  root_cause: "Root Cause",
  escape_point: "Escape Point",
  contributing_factors: "Contributing Factors",
  corrective_action: "Corrective Action",
  verification: "Verification",
  approval_comments: "Approval Comments",
  approved_by: "Approved By",
  approval_date: "Approval Date",
};

export function labelForField(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Labels for the keys in `fields` whose context value is empty. */
export function missingRequiredLabels(fields: unknown, context: Record<string, unknown>): string[] {
  if (!Array.isArray(fields)) return [];
  const missing: string[] = [];
  for (const field of fields) {
    if (typeof field !== "string" || !field.trim()) continue;
    if (isBlank(context[field])) missing.push(labelForField(field));
  }
  return missing;
}

export function assertRequiredMove(missing: string[]): void {
  if (missing.length > 0) throw new Error(requiredMoveMessage(missing));
}

export function requiredMoveError(missing: string[]): AppError {
  return AppError.badRequest(requiredMoveMessage(missing));
}

/** Forward and approve moves check required fields. A rejection does not. */
export function moveNeedsRequiredFields(decision: string): boolean {
  return decision !== "rejected" && decision !== "false";
}
