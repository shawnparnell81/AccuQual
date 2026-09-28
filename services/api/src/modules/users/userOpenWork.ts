import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { documents } from "../../drizzle/schema/documents.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { users } from "../../drizzle/schema/users.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { trainingAssignments, trainingCompetencies, trainingCourses } from "../../drizzle/schema/training.js";
import { riskAssessments, riskMitigations } from "../../drizzle/schema/risk.js";
import { audits } from "../../drizzle/schema/audits.js";
import { feasibilityReviews } from "../../drizzle/schema/feasibility.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { eightDIsClosed } from "../quality-automation/logic.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

/**
 * Work still in progress that names this person. Historical authorship,
 * approvals, and signatures are not in this list and are never rewritten:
 * a record stays editable by anyone who already has permission to edit it,
 * whether or not the person who created or signed it is still active.
 *
 * An open 8D has no owner column. The product treats the assignee of its
 * linked open NCR as the owner, so moving that NCR moves the 8D with it.
 */

const OPEN_NCR = ["open", "contained", "investigating", "corrective_action"] as const;
const OPEN_CAPA = ["open", "in_progress", "verifying"] as const;
const PREVIEW_LIMIT = 8;

export interface OpenWorkItem {
  id: number;
  title: string;
}

export interface OpenWorkGroup {
  key: string;
  label: string;
  count: number;
  items: OpenWorkItem[];
}

function clip(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function group(key: string, label: string, rows: OpenWorkItem[]): OpenWorkGroup | null {
  if (rows.length === 0) return null;
  return { key, label, count: rows.length, items: rows.slice(0, PREVIEW_LIMIT) };
}

function openNcrWhere(userId: number) {
  return and(eq(ncr.assignedTo, userId), eq(ncr.isDeleted, false), inArray(ncr.status, [...OPEN_NCR]));
}

function openCapaWhere(userId: number) {
  return and(eq(capa.ownerId, userId), inArray(capa.status, [...OPEN_CAPA]));
}

function documentReviewWhere(userId: number) {
  return and(eq(documents.ownerId, userId), eq(documents.isDeleted, false), inArray(documents.status, ["draft", "in_review"]));
}

function reviewerWhere(userId: number) {
  return and(eq(controlledVersions.status, "in_review"), sql`(${controlledVersions.metadata} ->> 'assignedReviewerId') = ${String(userId)}`);
}

async function openEightDs(db: Db, userId: number): Promise<OpenWorkItem[]> {
  const owned = await db.select({ id: ncr.id }).from(ncr).where(openNcrWhere(userId));
  if (owned.length === 0) return [];
  const reports = await db
    .select({ id: eightD.id, data: eightD.data })
    .from(eightD)
    .where(inArray(eightD.ncrId, owned.map((row) => row.id)));
  return reports.filter((row) => !eightDIsClosed((row.data ?? {}) as Record<string, unknown>)).map((row) => ({ id: row.id, title: `8D #${row.id}` }));
}

/** Open items this person still owns, assigned, or is waiting to sign. */
export async function loadOpenWork(db: Db, userId: number): Promise<OpenWorkGroup[]> {
  const [ncrs, capas, eightds, docs, reviews, reports, complaintsRows, investigations, training, risks, actions, auditRows, feasibility, ppaps, evaluations] = await Promise.all([
    db.select({ id: ncr.id, title: ncr.title }).from(ncr).where(openNcrWhere(userId)),
    db.select({ id: capa.id, title: capa.actionPlan }).from(capa).where(openCapaWhere(userId)),
    openEightDs(db, userId),
    db.select({ id: documents.id, title: documents.title }).from(documents).where(documentReviewWhere(userId)),
    db.select({ id: controlledVersions.id, subjectType: controlledVersions.subjectType, subjectId: controlledVersions.subjectId }).from(controlledVersions).where(reviewerWhere(userId)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.managerId, userId)),
    db.select({ id: complaints.id, title: complaints.description }).from(complaints).where(and(eq(complaints.assignedTo, userId), inArray(complaints.status, ["open", "investigating"]))),
    db.select({ id: discrepancyInvestigations.id, title: discrepancyInvestigations.title }).from(discrepancyInvestigations).where(and(eq(discrepancyInvestigations.assignedTo, userId), inArray(discrepancyInvestigations.status, ["open", "investigating"]))),
    db
      .select({ id: trainingAssignments.id, title: trainingCourses.title })
      .from(trainingAssignments)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingAssignments.courseId))
      .where(and(eq(trainingAssignments.userId, userId), inArray(trainingAssignments.status, ["assigned", "in_progress", "overdue"]))),
    db.select({ id: riskAssessments.id, title: riskAssessments.title }).from(riskAssessments).where(and(eq(riskAssessments.ownerId, userId), ne(riskAssessments.status, "closed"))),
    db.select({ id: riskMitigations.id, title: riskMitigations.action }).from(riskMitigations).where(and(eq(riskMitigations.ownerId, userId), ne(riskMitigations.status, "completed"))),
    db.select({ id: audits.id, title: audits.name }).from(audits).where(and(eq(audits.auditorId, userId), ne(audits.status, "completed"))),
    db.select({ id: feasibilityReviews.id }).from(feasibilityReviews).where(and(eq(feasibilityReviews.ownerId, userId), eq(feasibilityReviews.status, "draft"))),
    db.select({ id: ppapPackages.id, title: ppapPackages.partNumber }).from(ppapPackages).where(and(eq(ppapPackages.ownerId, userId), inArray(ppapPackages.status, ["open", "submitted"]))),
    db.select({ id: trainingCompetencies.id }).from(trainingCompetencies).where(and(eq(trainingCompetencies.evaluatorId, userId), eq(trainingCompetencies.status, "pending"))),
  ]);

  const groups = [
    group("open_ncrs", "open NCRs", ncrs.map((row) => ({ id: row.id, title: clip(row.title, `NCR #${row.id}`) }))),
    group("open_capas", "open CAPAs", capas.map((row) => ({ id: row.id, title: clip(row.title, `CAPA #${row.id}`) }))),
    group("open_eightds", "open 8D reports", eightds),
    group("document_reviews", "documents in draft or review", docs.map((row) => ({ id: row.id, title: clip(row.title, `Document #${row.id}`) }))),
    group("pending_reviews", "reviews waiting on them", reviews.map((row) => ({ id: row.id, title: `${row.subjectType} #${row.subjectId}` }))),
    group("direct_reports", "people who report to them", reports.map((row) => ({ id: row.id, title: row.name?.trim() || row.email }))),
    group("complaints", "open complaints", complaintsRows.map((row) => ({ id: row.id, title: clip(row.title, `Complaint #${row.id}`) }))),
    group("investigations", "open investigations", investigations.map((row) => ({ id: row.id, title: clip(row.title, `Investigation #${row.id}`) }))),
    group("training", "training assignments", training.map((row) => ({ id: row.id, title: clip(row.title, `Training #${row.id}`) }))),
    group("risks", "open risks", risks.map((row) => ({ id: row.id, title: clip(row.title, `Risk #${row.id}`) }))),
    group("risk_actions", "risk actions", actions.map((row) => ({ id: row.id, title: clip(row.title, `Risk action #${row.id}`) }))),
    group("audits", "open audits", auditRows.map((row) => ({ id: row.id, title: clip(row.title, `Audit #${row.id}`) }))),
    group("feasibility", "feasibility reviews", feasibility.map((row) => ({ id: row.id, title: `Feasibility review #${row.id}` }))),
    group("ppap", "PPAP packages", ppaps.map((row) => ({ id: row.id, title: clip(row.title, `PPAP #${row.id}`) }))),
    group("evaluations", "competency evaluations", evaluations.map((row) => ({ id: row.id, title: `Competency evaluation #${row.id}` }))),
  ];
  return groups.filter((item): item is OpenWorkGroup => item !== null);
}

export interface ReassignNote {
  fromName: string;
  toName: string;
  performedBy?: number;
}

async function noteMove(db: Db, note: ReassignNote | undefined, entityType: string, entityId: number) {
  if (!note) return;
  await recordAuditTrail(db, {
    entityType,
    entityId,
    action: "status_change",
    changes: { action: `Reassigned from ${note.fromName} to ${note.toName} when ${note.fromName} was removed` },
    performedBy: note.performedBy,
  });
}

/**
 * Moves the open items onto the replacement. Signature columns (createdBy,
 * approvedBy, reviewedBy, verifiedBy, publishedBy, submittedBy) are left
 * as they were. Each moved record gets a history line naming both people.
 * An open 8D has no owner column; the note is written on the report because
 * its linked NCR moved with it.
 */
export async function reassignOpenWork(db: Db, userId: number, replacementId: number, note?: ReassignNote): Promise<OpenWorkGroup[]> {
  const groups = await loadOpenWork(db, userId);
  const keys = new Set(groups.map((item) => item.key));
  const now = new Date();
  const eightDIds = keys.has("open_eightds") ? (await openEightDs(db, userId)).map((row) => row.id) : [];

  if (keys.has("open_ncrs")) {
    const rows = await db.update(ncr).set({ assignedTo: replacementId, updatedAt: now }).where(openNcrWhere(userId)).returning({ id: ncr.id });
    for (const row of rows) await noteMove(db, note, "NCR", row.id);
  }
  for (const id of eightDIds) await noteMove(db, note, "8D Report", id);
  if (keys.has("open_capas")) {
    const rows = await db.update(capa).set({ ownerId: replacementId, updatedAt: now }).where(openCapaWhere(userId)).returning({ id: capa.id });
    for (const row of rows) await noteMove(db, note, "CAPA", row.id);
  }
  if (keys.has("document_reviews")) {
    const rows = await db.update(documents).set({ ownerId: replacementId, updatedAt: now }).where(documentReviewWhere(userId)).returning({ id: documents.id });
    for (const row of rows) await noteMove(db, note, "Document", row.id);
  }
  if (keys.has("pending_reviews")) {
    const rows = await db
      .update(controlledVersions)
      .set({ metadata: sql`jsonb_set(${controlledVersions.metadata}, '{assignedReviewerId}', to_jsonb(${replacementId}::int))` })
      .where(reviewerWhere(userId))
      .returning({ id: controlledVersions.id, subjectType: controlledVersions.subjectType, subjectId: controlledVersions.subjectId });
    for (const row of rows) {
      if (row.subjectType === "document") await noteMove(db, note, "Document", row.subjectId);
    }
  }
  if (keys.has("direct_reports")) {
    const rows = await db.update(users).set({ managerId: replacementId, updatedAt: now }).where(and(eq(users.managerId, userId), ne(users.id, replacementId))).returning({ id: users.id });
    for (const row of rows) await noteMove(db, note, "User", row.id);
    await db.update(users).set({ managerId: null, updatedAt: now }).where(and(eq(users.id, replacementId), eq(users.managerId, userId)));
  }
  if (keys.has("complaints")) {
    const rows = await db.update(complaints).set({ assignedTo: replacementId, updatedAt: now }).where(and(eq(complaints.assignedTo, userId), inArray(complaints.status, ["open", "investigating"]))).returning({ id: complaints.id });
    for (const row of rows) await noteMove(db, note, "Complaint", row.id);
  }
  if (keys.has("investigations")) {
    const rows = await db
      .update(discrepancyInvestigations)
      .set({ assignedTo: replacementId, updatedAt: now })
      .where(and(eq(discrepancyInvestigations.assignedTo, userId), inArray(discrepancyInvestigations.status, ["open", "investigating"])))
      .returning({ id: discrepancyInvestigations.id });
    for (const row of rows) await noteMove(db, note, "Discrepancy investigation", row.id);
  }
  if (keys.has("training")) {
    const rows = await db
      .update(trainingAssignments)
      .set({ userId: replacementId })
      .where(and(eq(trainingAssignments.userId, userId), inArray(trainingAssignments.status, ["assigned", "in_progress", "overdue"])))
      .returning({ id: trainingAssignments.id });
    for (const row of rows) await noteMove(db, note, "TrainingAssignment", row.id);
  }
  if (keys.has("risks")) {
    const rows = await db.update(riskAssessments).set({ ownerId: replacementId, updatedAt: now }).where(and(eq(riskAssessments.ownerId, userId), ne(riskAssessments.status, "closed"))).returning({ id: riskAssessments.id });
    for (const row of rows) await noteMove(db, note, "RiskAssessment", row.id);
  }
  if (keys.has("risk_actions")) {
    const rows = await db.update(riskMitigations).set({ ownerId: replacementId, updatedAt: now }).where(and(eq(riskMitigations.ownerId, userId), ne(riskMitigations.status, "completed"))).returning({ id: riskMitigations.id });
    for (const row of rows) await noteMove(db, note, "RiskMitigation", row.id);
  }
  if (keys.has("audits")) {
    const rows = await db.update(audits).set({ auditorId: replacementId }).where(and(eq(audits.auditorId, userId), ne(audits.status, "completed"))).returning({ id: audits.id });
    for (const row of rows) await noteMove(db, note, "Audit", row.id);
  }
  if (keys.has("feasibility")) {
    const rows = await db.update(feasibilityReviews).set({ ownerId: replacementId, updatedAt: now }).where(and(eq(feasibilityReviews.ownerId, userId), eq(feasibilityReviews.status, "draft"))).returning({ id: feasibilityReviews.id });
    for (const row of rows) await noteMove(db, note, "FeasibilityReview", row.id);
  }
  if (keys.has("ppap")) {
    const rows = await db.update(ppapPackages).set({ ownerId: replacementId }).where(and(eq(ppapPackages.ownerId, userId), inArray(ppapPackages.status, ["open", "submitted"]))).returning({ id: ppapPackages.id });
    for (const row of rows) await noteMove(db, note, "PPAP package", row.id);
  }
  if (keys.has("evaluations")) {
    const rows = await db.update(trainingCompetencies).set({ evaluatorId: replacementId }).where(and(eq(trainingCompetencies.evaluatorId, userId), eq(trainingCompetencies.status, "pending"))).returning({ id: trainingCompetencies.id });
    for (const row of rows) await noteMove(db, note, "TrainingCompetency", row.id);
  }
  return groups;
}
