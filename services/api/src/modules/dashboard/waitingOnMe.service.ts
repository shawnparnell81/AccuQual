import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { documents } from "../../drizzle/schema/documents.js";
import { trainingAssignments, trainingCourses } from "../../drizzle/schema/training.js";
import { audits } from "../../drizzle/schema/audits.js";
import { users } from "../../drizzle/schema/users.js";
import { faiRecords, faiAnnualPulls, faiSourceApprovals } from "../../drizzle/schema/faiSourceControl.js";
import { equipment, calibrations } from "../../drizzle/schema/calibration.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { summarize } from "../calibration/calibration.service.js";
import { approvalsWaitingOnUser } from "../workflow/workflow.runs.js";
import { buildWaitingItems, presentWaitingList, sanitizeWaitingPrefs, type WaitingPrefs } from "./waitingOnMe.js";

const CAP = 40;

/**
 * Work the signed-in person can already open. Each module is queried only
 * when that person can read it, and each query is capped.
 * Validation reports have no due date, so they are not listed.
 */
export async function loadWaitingOnMe(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  siteIds: number[],
  prefs: WaitingPrefs,
) {
  const keys = ["ncr", "capa", "fai", "calibration", "documents", "training", "audit"] as const;
  const levels = await Promise.all(keys.map(async (key) => [key, await getUserAccessLevel(db, user, key)] as const));
  const access = Object.fromEntries(levels.map(([key, level]) => [key, level !== "none"])) as Record<(typeof keys)[number], boolean>;
  const onSites = siteIds.length > 0;

  const ncrs = access.ncr && onSites
    ? await db
        .select({ id: ncr.id, title: ncr.title, status: ncr.status, assignedTo: ncr.assignedTo, dueDate: ncr.dueDate, siteId: ncr.siteId, isDeleted: ncr.isDeleted })
        .from(ncr)
        .where(and(eq(ncr.assignedTo, user.id), ne(ncr.status, "closed"), eq(ncr.isDeleted, false), inArray(ncr.siteId, siteIds)))
        .limit(CAP)
    : [];

  const capas = access.capa && onSites
    ? await db
        .select({ id: capa.id, status: capa.status, ownerId: capa.ownerId, verifiedBy: capa.verifiedBy, dueDate: capa.dueDate, siteId: capa.siteId, rootCause: capa.rootCause })
        .from(capa)
        .where(and(ne(capa.status, "closed"), inArray(capa.siteId, siteIds)))
        .limit(CAP * 2)
    : [];

  const records = access.fai
    ? await db
        .select({ id: faiRecords.id, number: faiRecords.number, partNumber: faiRecords.partNumber, status: faiRecords.status, assignedTo: faiRecords.assignedTo, supplierName: faiRecords.supplierName })
        .from(faiRecords)
        .where(and(eq(faiRecords.assignedTo, user.id), ne(faiRecords.status, "approved"), ne(faiRecords.status, "rejected")))
        .limit(CAP)
    : [];

  const pulls = access.fai
    ? await db
        .select({ id: faiAnnualPulls.id, partNumber: faiAnnualPulls.partNumber, assignedTo: faiAnnualPulls.assignedTo, completedAt: faiAnnualPulls.completedAt })
        .from(faiAnnualPulls)
        .where(and(eq(faiAnnualPulls.assignedTo, user.id), isNull(faiAnnualPulls.completedAt)))
        .limit(CAP)
    : [];

  const sources = access.fai
    ? await db
        .select({ id: faiSourceApprovals.id, partNumber: faiSourceApprovals.partNumber, supplierName: faiSourceApprovals.supplierName, status: faiSourceApprovals.status, nextDueDate: faiSourceApprovals.nextDueDate })
        .from(faiSourceApprovals)
        .orderBy(desc(faiSourceApprovals.updatedAt))
        .limit(200)
    : [];

  let gages: { id: number; name: string; serialNumber: string | null; dueStatus: string; nextDueAt: Date | null }[] = [];
  if (access.calibration) {
    const items = await db.select().from(equipment).limit(200);
    const ids = items.map((item) => item.id);
    const cals = ids.length > 0 ? await db.select().from(calibrations).where(inArray(calibrations.equipmentId, ids)) : [];
    const summary = summarize(items, cals);
    gages = items
      .map((item) => {
        const row = summary.get(item.id);
        return { id: item.id, name: item.name, serialNumber: item.serialNumber, dueStatus: row?.dueStatus ?? "uncalibrated", nextDueAt: row?.nextDueAt ?? null };
      })
      .filter((row) => row.dueStatus === "overdue" || row.dueStatus === "due_soon" || row.dueStatus === "failed")
      .slice(0, CAP);
  }

  const approvals = await approvalsWaitingOnUser(db, user);

  const ownedDocs = access.documents
    ? await db
        .select({ id: documents.id, title: documents.title, status: documents.status, ownerId: documents.ownerId })
        .from(documents)
        .where(and(eq(documents.ownerId, user.id), eq(documents.status, "in_review"), eq(documents.isDeleted, false)))
        .limit(CAP)
    : [];

  const reviewRows = access.documents
    ? await db
        .select({ subjectId: controlledVersions.subjectId, metadata: controlledVersions.metadata })
        .from(controlledVersions)
        .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.status, "in_review")))
        .limit(80)
    : [];
  const reviewIds = reviewRows
    .filter((row) => Number((row.metadata as { assignedReviewerId?: unknown } | null)?.assignedReviewerId) === user.id)
    .map((row) => row.subjectId);
  const reviewed = reviewIds.length
    ? await db.select({ id: documents.id, title: documents.title, status: documents.status, ownerId: documents.ownerId }).from(documents).where(inArray(documents.id, reviewIds)).limit(CAP)
    : [];
  const documentMap = new Map<number, { id: number; title: string; status: string; ownerId: number | null; assignedReviewerId: number | null }>();
  for (const row of ownedDocs) documentMap.set(row.id, { ...row, assignedReviewerId: null });
  for (const row of reviewed) {
    const existing = documentMap.get(row.id);
    documentMap.set(row.id, { ...row, assignedReviewerId: existing?.assignedReviewerId ?? user.id });
  }

  const training = access.training
    ? await db
        .select({ id: trainingAssignments.id, title: trainingCourses.title, status: trainingAssignments.status, userId: trainingAssignments.userId, dueAt: trainingAssignments.dueAt })
        .from(trainingAssignments)
        .innerJoin(trainingCourses, eq(trainingCourses.id, trainingAssignments.courseId))
        .where(and(eq(trainingAssignments.userId, user.id), ne(trainingAssignments.status, "completed")))
        .limit(CAP)
    : [];

  const auditRows = access.audit && onSites
    ? await db
        .select({ id: audits.id, name: audits.name, status: audits.status, auditorId: audits.auditorId, scheduledAt: audits.scheduledAt })
        .from(audits)
        .where(and(eq(audits.auditorId, user.id), ne(audits.status, "completed"), inArray(audits.siteId, siteIds)))
        .limit(CAP)
    : [];

  const nameIds = [
    user.id,
    ...ncrs.map((row) => row.assignedTo ?? 0),
    ...capas.map((row) => row.ownerId ?? 0),
    ...records.map((row) => row.assignedTo ?? 0),
    ...pulls.map((row) => row.assignedTo ?? 0),
    ...auditRows.map((row) => row.auditorId ?? 0),
  ];
  const unique = [...new Set(nameIds.filter((id) => id > 0))];
  const people = unique.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique)) : [];
  const names = Object.fromEntries(people.map((row) => [row.id, row.name]));

  const items = buildWaitingItems({
    now: new Date(),
    userId: user.id,
    access,
    names,
    siteIds,
    ncrs,
    capas,
    faiRecords: records,
    pulls,
    sources,
    gages,
    approvals,
    documents: [...documentMap.values()],
    training,
    audits: auditRows,
  });
  return { items, ...presentWaitingList(items, prefs), prefs };
}

export function readWaitingPrefs(layout: unknown): WaitingPrefs {
  const record = layout && typeof layout === "object" ? (layout as { waitingOnMe?: unknown }).waitingOnMe : undefined;
  return sanitizeWaitingPrefs(record);
}
