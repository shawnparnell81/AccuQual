/**
 * Same rule as services/api/src/modules/calibration/gageUsage.ts.
 * Overdue, failed, inactive, and out-of-service gages cannot be used to measure.
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
