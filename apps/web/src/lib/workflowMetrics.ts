/**
 * Pure client-side metric helpers shared by the workflow dashboards — no
 * backend change, no new endpoint (see the Workflow Dashboards brief,
 * section 3/4: "compute metrics client-side" from existing list data).
 * Several modules genuinely have no server-computed "overdue"/"expired"
 * concept (Training, Audit — confirmed across the Outputs/Rules/Audit Trail
 * Dictionaries); these compute it here from real stored dates instead of
 * requiring a backend change, the same way Calibration's own
 * calibrationStatusFromDueDate (components/forms/formulas.ts) already does.
 */

export type ExpirationStatus = "expired" | "expiring_soon" | null;

/** Same thresholds as documents.controller.ts's expirationStatus() / DocumentRetentionPanel's local copy — kept here as the one shared version instead of a third copy. */
export function documentExpirationStatus(expirationDate: string | null, warningDays: number): ExpirationStatus {
  if (!expirationDate) return null;
  const now = new Date();
  const expiresAt = new Date(expirationDate);
  if (now >= expiresAt) return "expired";
  const warnAt = new Date(expiresAt);
  warnAt.setDate(warnAt.getDate() - warningDays);
  return now >= warnAt ? "expiring_soon" : null;
}

/** Training has a real `dueAt` and an "overdue" status value in its schema's enum comment, but nothing server-side ever writes it (see the Outputs Dictionary) — computed here from the one real date that exists. */
export function isTrainingOverdue(dueAt: string | null, status: string): boolean {
  return status !== "completed" && !!dueAt && new Date(dueAt) < new Date();
}

/** Same situation as training: Audit has no server-computed "overdue" for a missed scheduled date (see the Rules Dictionary). */
export function isAuditOverdue(scheduledAt: string | null, status: string): boolean {
  return status === "scheduled" && !!scheduledAt && new Date(scheduledAt) < new Date();
}

export interface MonthBucket {
  key: string; // "2026-09"
  label: string; // "Sep 2026"
  count: number;
}

/** Buckets a list of ISO date strings (nulls skipped) into the last `months` calendar months, oldest first — the shared shape every trend chart in this dashboard set renders. */
export function bucketByMonth(dates: (string | null | undefined)[], months = 6): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      count: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const raw of dates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
