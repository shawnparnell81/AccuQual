import { useQueries } from "@tanstack/react-query";
import { createResourceHooks } from "../api/resourceHooks";
import { apiClient } from "../api/client";
import { documentExpirationStatus, isTrainingOverdue, isAuditOverdue } from "../lib/workflowMetrics";
import type { Ncr, Capa, Audit, Supplier, AccuQualDocument, TrainingCourse, TrainingAssignment, AuditItem } from "../api/types";

interface Equipment {
  id: number;
  name: string;
  calibrationIntervalDays: number;
  nextDueAt: string | null;
}

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");
const auditHooks = createResourceHooks<Audit>("audits");
const supplierHooks = createResourceHooks<Supplier>("suppliers");
const documentHooks = createResourceHooks<AccuQualDocument>("documents");
const equipmentHooks = createResourceHooks<Equipment>("equipment");
const courseHooks = createResourceHooks<TrainingCourse>("training");

export interface OverdueItem {
  module: "calibration" | "documents" | "training" | "audit";
  label: string;
  detail: string;
  link: string;
  /** Whole days past its due/expiration date — the real, uniformly-available sort key. None of these four modules has a severity field of its own (only NCR/audit findings do, and neither is "overdue"-tracked), so "most overdue first" stands in for the brief's "severity + due date" sort. */
  daysOverdue: number;
}

export interface PendingItem {
  module: "documents" | "capa" | "di";
  label: string;
  detail: string;
  link: string;
}

/**
 * One place that fetches every module's list (each via the same
 * createResourceHooks the module's own list/detail pages already use, so
 * this shares React Query's cache with them rather than re-fetching) and
 * derives every cross-module dashboard metric. Two fan-outs are real but
 * deliberately bounded: training assignments (one request per COURSE, not
 * per assignment) and audit findings (one request per AUDIT, not per
 * finding) — both counts are normally small for a QMS company; a bulk
 * "all assignments" or "all findings" endpoint doesn't exist and adding one
 * is out of scope (see the brief's "no new endpoints").
 */
export function useWorkflowDashboardData() {
  const ncrQ = ncrHooks.useList();
  const capaQ = capaHooks.useList();
  const auditQ = auditHooks.useList();
  const supplierQ = supplierHooks.useList();
  const documentQ = documentHooks.useList();
  const equipmentQ = equipmentHooks.useList();
  const courseQ = courseHooks.useList();

  const courses = courseQ.data ?? [];
  const assignmentQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: ["training-assignments", course.id],
      queryFn: async () => (await apiClient.get<TrainingAssignment[]>(`/training/${course.id}/assignments`)).data,
      enabled: courseQ.isSuccess,
    })),
  });
  const assignments = assignmentQueries.flatMap((q) => q.data ?? []);
  const assignmentsLoaded = courseQ.isSuccess && assignmentQueries.every((q) => q.isSuccess || q.isError);

  const audits = auditQ.data ?? [];
  const itemQueries = useQueries({
    queries: audits.map((audit) => ({
      queryKey: ["audits", audit.id, "items"],
      queryFn: async () => (await apiClient.get<AuditItem[]>(`/audits/${audit.id}/item`)).data,
      enabled: auditQ.isSuccess,
    })),
  });
  const auditItems = itemQueries.flatMap((q) => q.data ?? []);

  const isLoading = ncrQ.isLoading || capaQ.isLoading || auditQ.isLoading || supplierQ.isLoading || documentQ.isLoading || equipmentQ.isLoading || courseQ.isLoading;
  const isError = ncrQ.isError || capaQ.isError || auditQ.isError || supplierQ.isError || documentQ.isError || equipmentQ.isError || courseQ.isError;

  const documents = documentQ.data ?? [];
  const equipment = equipmentQ.data ?? [];
  const ncrs = ncrQ.data ?? [];
  const capas = capaQ.data ?? [];
  const suppliers = supplierQ.data ?? [];
  // GET /training/:id/assignments (unlike GET /training/employee/:userId/history) doesn't
  // include courseTitle on each row — resolved here from the course list already in hand.
  const courseTitleById = new Map(courses.map((c) => [c.id, c.title]));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const daysSince = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);

  // ---- Overdue, cross-module (only where a real due/expiration date exists), most overdue first ----
  const overdue: OverdueItem[] = [
    ...equipment
      .filter((e) => e.nextDueAt && new Date(e.nextDueAt) < now)
      .map((e) => ({
        module: "calibration" as const,
        label: e.name,
        detail: `Past due ${new Date(e.nextDueAt!).toLocaleDateString()}`,
        link: `/calibration/${e.id}`,
        daysOverdue: daysSince(e.nextDueAt!),
      })),
    ...documents
      .filter((d) => documentExpirationStatus(d.expirationDate, d.expirationWarningDays) === "expired")
      .map((d) => ({
        module: "documents" as const,
        label: d.title,
        detail: `Expired ${new Date(d.expirationDate!).toLocaleDateString()}`,
        link: `/documents/${d.id}`,
        daysOverdue: daysSince(d.expirationDate!),
      })),
    ...assignments
      .filter((a) => isTrainingOverdue(a.dueAt, a.status))
      .map((a) => ({
        module: "training" as const,
        label: a.courseTitle ?? courseTitleById.get(a.courseId) ?? `Course #${a.courseId}`,
        detail: `Due ${new Date(a.dueAt!).toLocaleDateString()} — ${a.userName ?? a.userEmail ?? `User #${a.userId}`}`,
        link: `/training/${a.courseId}`,
        daysOverdue: daysSince(a.dueAt!),
      })),
    ...audits
      .filter((a) => isAuditOverdue(a.scheduledAt, a.status))
      .map((a) => ({
        module: "audit" as const,
        label: a.name,
        detail: `Scheduled ${new Date(a.scheduledAt!).toLocaleDateString()}`,
        link: `/audits/${a.id}`,
        daysOverdue: daysSince(a.scheduledAt!),
      })),
  ].sort((a, b) => b.daysOverdue - a.daysOverdue);

  // ---- Pending decisions, cross-module (only where a real "awaiting X" state exists) ----
  const pending: PendingItem[] = [
    ...documents.filter((d) => d.status === "in_review").map((d) => ({ module: "documents" as const, label: d.title, detail: "Awaiting approval", link: `/documents/${d.id}` })),
    ...capas.filter((c) => c.status === "verifying").map((c) => ({ module: "capa" as const, label: `CAPA #${c.id}`, detail: "Awaiting verification", link: `/capa/${c.id}` })),
  ];

  function refetch() {
    ncrQ.refetch();
    capaQ.refetch();
    auditQ.refetch();
    supplierQ.refetch();
    documentQ.refetch();
    equipmentQ.refetch();
    courseQ.refetch();
    // The two fan-outs (per-course assignments, per-audit items) re-run on their own once
    // courses/audits refetch successfully — their queryKeys depend on the parent list's ids.
  }

  return {
    isLoading,
    isError,
    refetch,
    ncrs,
    capas,
    audits,
    suppliers,
    documents,
    equipment,
    courses,
    assignments,
    assignmentsLoaded,
    auditItems,
    overdue,
    pending,
    now,
    startOfMonth,
    endOfMonth,
  };
}
