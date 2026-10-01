/**
 * Whether a gage may be used to measure. Recording or scheduling its own
 * calibration stays allowed — that is how an overdue or failed gage gets
 * back into service. Training is not part of this check.
 *
 * Keep the wording in sync with apps/web/src/lib/gageUsage.ts.
 */

export type GageUseStatus = "active" | "inactive" | "out_of_service";
export type GageUseDue = "failed" | "overdue" | "due_soon" | "upcoming" | "current" | "uncalibrated";

export function gageUsageBlockReason(status: GageUseStatus, dueStatus: GageUseDue): string | null {
  if (status === "inactive") return "This gage is inactive and cannot be used.";
  if (status === "out_of_service") return "This gage is out of service and cannot be used.";
  if (dueStatus === "failed") return "This gage failed calibration and cannot be used until it passes.";
  if (dueStatus === "overdue") return "This gage is overdue for calibration and cannot be used.";
  return null;
}

/** Gage IDs typed on a final-inspection characteristic row. Blank cells are ignored. */
export function inspectionGageIds(data: Record<string, unknown>): string[] {
  const rows = data.keyCharacteristicResults;
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const gageId = (row as { gageId?: unknown }).gageId;
    if (typeof gageId !== "string") continue;
    const trimmed = gageId.trim();
    if (trimmed) ids.push(trimmed);
  }
  return [...new Set(ids)];
}
