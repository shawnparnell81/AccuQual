import { and, asc, desc, eq, gte, inArray, like } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { db as ownerDb } from "../../db/index.js";
import {
  trainingCourses,
  trainingAssignments,
  trainingSessions,
  trainingCompetencies,
  type TrainingCourse,
  type TrainingAssignment,
  type TrainingSession,
  type TrainingCompetency,
  type CourseRequirements,
} from "../../drizzle/schema/training.js";
import { users } from "../../drizzle/schema/users.js";
import { documents } from "../../drizzle/schema/documents.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyDepartment, notifyRecipients } from "../notifications/notification.service.js";
import { env } from "../../config/env.js";
import { appRecordUrl } from "../../lib/recordLink.js";

/**
 * Training & competency rules, in one place.
 *
 *  - A person is TRAINED for a course when an assignment of theirs is completed (directly, or by attending a session). If the course
 *    needs an evaluation, they are only QUALIFIED once a competency evaluation of theirs has passed as well.
 *  - Training and evaluations can expire (the course's validity), and training is out of date when the controlled document the
 *    course teaches has been revised since the person was trained.
 *  - Everything about "who is not qualified" is computed from those records; nothing is a stored flag that can drift.
 */

const DAY_MS = 86_400_000;
export const EXPIRING_SOON_DAYS = 30;

export type QualificationStatus = "qualified" | "expiring_soon" | "expired" | "revision_changed" | "failed" | "awaiting_evaluation" | "overdue" | "in_progress" | "assigned" | "not_trained";

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ---- Who is qualified (pure) ----------------------------------------------------------------------------------------------------------------------

export interface QualificationInputs {
  evaluationRequired: boolean;
  /** The linked controlled document's released version now (null when the course has none). */
  documentVersionNow: number | null;
  latestCompleted: { completedAt: Date; expiresAt: Date | null; documentVersion: number | null } | null;
  latestDecidedEvaluation: { status: "pass" | "fail"; evaluatedAt: Date; expiresAt: Date | null } | null;
  openAssignment: { status: string; dueAt: Date | null } | null;
}

/** Where one person stands on one course. Pure, so the rules can be tested exactly. */
export function qualificationStatus(i: QualificationInputs, now: Date = new Date()): { status: QualificationStatus; expiresAt: Date | null } {
  const trained = i.latestCompleted !== null;
  const evalFailedSinceTraining = i.latestDecidedEvaluation?.status === "fail" && (!i.latestCompleted || i.latestCompleted.completedAt.getTime() <= i.latestDecidedEvaluation.evaluatedAt.getTime());
  const evalPassed = i.latestDecidedEvaluation?.status === "pass";

  if (i.evaluationRequired && evalFailedSinceTraining) return { status: "failed", expiresAt: null };

  if (!trained || (i.evaluationRequired && !evalPassed)) {
    if (trained && i.evaluationRequired) return { status: "awaiting_evaluation", expiresAt: null };
    if (i.openAssignment) {
      const late = i.openAssignment.dueAt !== null && i.openAssignment.dueAt.getTime() < now.getTime();
      return { status: late ? "overdue" : i.openAssignment.status === "in_progress" ? "in_progress" : "assigned", expiresAt: null };
    }
    return { status: "not_trained", expiresAt: null };
  }

  // Trained (and, where required, evaluated): is it still good?
  const expiries = [i.latestCompleted!.expiresAt, i.evaluationRequired ? (i.latestDecidedEvaluation?.expiresAt ?? null) : null].filter((d): d is Date => d !== null);
  const expiresAt = expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null;
  if (expiresAt && expiresAt.getTime() < now.getTime()) return { status: "expired", expiresAt };
  if (i.documentVersionNow !== null && i.latestCompleted!.documentVersion !== null && i.latestCompleted!.documentVersion < i.documentVersionNow) return { status: "revision_changed", expiresAt };
  if (expiresAt && expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) return { status: "expiring_soon", expiresAt };
  return { status: "qualified", expiresAt };
}

/** Anything that asks for someone to do something about it. */
export const NEEDS_ACTION: readonly QualificationStatus[] = ["failed", "expired", "revision_changed", "overdue", "awaiting_evaluation", "not_trained", "expiring_soon"];

export interface StatusRow {
  userId: number;
  userName: string | null;
  email: string;
  department: string | null;
  courseId: number;
  courseTitle: string;
  /** The course is required of this person (by their role or department), not just something they happened to take. */
  required: boolean;
  status: QualificationStatus;
  expiresAt: Date | null;
  lastCompletedAt: Date | null;
  openAssignmentId: number | null;
  dueAt: Date | null;
}

export interface StatusFilters {
  courseId?: number;
  userId?: number;
  department?: string;
  status?: string;
}

/** Everyone a course applies to (by requirement, or by having taken it), and where each of them stands. */
export async function trainingStatus(db: TenantDb, filters: StatusFilters = {}, now: Date = new Date()): Promise<StatusRow[]> {
  const courses = (await db.select().from(trainingCourses).where(and(eq(trainingCourses.active, true)))).filter((c) => !filters.courseId || c.id === filters.courseId);
  if (courses.length === 0) return [];
  const people = (await db.select({ id: users.id, name: users.name, email: users.email, department: users.department, roleId: users.roleId }).from(users).where(and(eq(users.isActive, true)))).filter((u) => (!filters.userId || u.id === filters.userId) && (!filters.department || u.department === filters.department));
  const courseIds = courses.map((c) => c.id);
  const assignments = await db.select().from(trainingAssignments).where(and(inArray(trainingAssignments.courseId, courseIds)));
  const evaluations = await db.select().from(trainingCompetencies).where(and(inArray(trainingCompetencies.courseId, courseIds)));
  const docIds = courses.map((c) => c.documentId).filter((d): d is number => d !== null);
  const docs = docIds.length ? await db.select({ id: documents.id, v: documents.currentVersion, status: documents.status }).from(documents).where(and(inArray(documents.id, docIds))) : [];
  const docVersion = new Map(docs.filter((d) => d.status === "approved" && d.v > 0).map((d) => [d.id, d.v]));

  const rows: StatusRow[] = [];
  for (const course of courses) {
    const req = (course.requirements ?? {}) as CourseRequirements;
    for (const person of people) {
      const mine = assignments.filter((a) => a.courseId === course.id && a.userId === person.id);
      const myEvals = evaluations.filter((e) => e.courseId === course.id && e.userId === person.id);
      const required = (course.requiredForRoleId !== null && person.roleId === course.requiredForRoleId) || (!!course.requiredForDepartment && person.department === course.requiredForDepartment);
      if (!required && mine.length === 0 && myEvals.length === 0) continue;

      const completed = mine.filter((a) => a.status === "completed" && a.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime() || b.id - a.id)[0] ?? null;
      const decided = myEvals.filter((e) => e.status !== "pending" && e.evaluatedAt).sort((a, b) => b.evaluatedAt!.getTime() - a.evaluatedAt!.getTime() || b.id - a.id)[0] ?? null;
      const open = mine.filter((a) => a.status === "assigned" || a.status === "in_progress").sort((a, b) => b.id - a.id)[0] ?? null;
      const q = qualificationStatus(
        {
          evaluationRequired: !!req.evaluationRequired,
          documentVersionNow: course.documentId !== null ? (docVersion.get(course.documentId) ?? null) : null,
          latestCompleted: completed ? { completedAt: completed.completedAt!, expiresAt: completed.expiresAt, documentVersion: completed.documentVersion } : null,
          latestDecidedEvaluation: decided ? { status: decided.status as "pass" | "fail", evaluatedAt: decided.evaluatedAt!, expiresAt: decided.expiresAt } : null,
          openAssignment: open ? { status: open.status, dueAt: open.dueAt } : null,
        },
        now,
      );
      if (filters.status && q.status !== filters.status) continue;
      rows.push({ userId: person.id, userName: person.name, email: person.email, department: person.department, courseId: course.id, courseTitle: course.title, required, status: q.status, expiresAt: q.expiresAt, lastCompletedAt: completed?.completedAt ?? null, openAssignmentId: open?.id ?? null, dueAt: open?.dueAt ?? null });
    }
  }
  return rows;
}

// ---- Assignments ----------------------------------------------------------------------------------------------------------------------------------

const AUDIT_ASSIGNMENT = "TrainingAssignment";

async function loadCourse(db: TenantDb, id: number): Promise<TrainingCourse> {
  const [course] = await db.select().from(trainingCourses).where(and(eq(trainingCourses.id, id)));
  if (!course) throw AppError.notFound("Training course");
  return course;
}

/** Ids that are active people in this organization; anything else is refused (an id from another organization must not get through). */
export async function assertTenantUsers(db: TenantDb, userIds: number[]): Promise<Map<number, { id: number; name: string | null; email: string }>> {
  const unique = [...new Set(userIds)];
  const found = unique.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.isActive, true), inArray(users.id, unique))) : [];
  if (found.length !== unique.length) throw AppError.badRequest("One or more of those people aren't active users in this organization.");
  return new Map(found.map((u) => [u.id, u]));
}

async function documentVersionNow(db: TenantDb, documentId: number | null): Promise<number | null> {
  if (documentId === null) return null;
  const [d] = await db.select({ v: documents.currentVersion, status: documents.status }).from(documents).where(and(eq(documents.id, documentId)));
  return d && d.status === "approved" && d.v > 0 ? d.v : null;
}

/** Assigns a course to people, skipping anyone who already has it open, and tells each of them. Returns the assignments created. */
export async function assignCourse(db: TenantDb, courseId: number, userIds: number[], opts: { dueAt?: Date; reason?: string }, actor?: number): Promise<TrainingAssignment[]> {
  const course = await loadCourse(db, courseId);
  if (!course.active) throw AppError.badRequest("This course is retired and can't be assigned.");
  const people = await assertTenantUsers(db, userIds);
  const open = await db.select({ userId: trainingAssignments.userId }).from(trainingAssignments).where(and(eq(trainingAssignments.courseId, courseId), inArray(trainingAssignments.status, ["assigned", "in_progress"])));
  const alreadyOpen = new Set(open.map((o) => o.userId));
  const created: TrainingAssignment[] = [];
  for (const userId of people.keys()) {
    if (alreadyOpen.has(userId)) continue;
    const [a] = await db.insert(trainingAssignments).values({ courseId, userId, dueAt: opts.dueAt, assignedBy: actor }).returning();
    if (!a) continue;
    created.push(a);
    await recordAuditTrail(db, { entityType: AUDIT_ASSIGNMENT, entityId: a.id, action: "create", changes: { action: "assign", courseId, userId, dueAt: opts.dueAt, ...(opts.reason ? { reason: opts.reason } : {}) }, performedBy: actor });
    await publishEvent(WORKFLOW_STREAM, { module: "training", event: "assigned", entityId: a.id, courseId });
    const p = people.get(userId)!;
    const courseUrl = appRecordUrl(env.FRONTEND_URL, `/training/${courseId}`);
    await notifyRecipients(db, [p.email], `Training assigned: ${course.title}`, `You have been assigned "${course.title}"${opts.dueAt ? `, due ${opts.dueAt.toISOString().slice(0, 10)}` : ""}${opts.reason ? ` (${opts.reason})` : ""}.\n\nOpen it: ${courseUrl}`, "training", courseId).catch((err) => logger.error("Training notice failed", { err: String(err) }));
  }
  return created;
}

/** Assigns the course to everyone it is required of who isn't currently qualified (never trained, expired, out of date with the document, or failed) and has nothing open. */
export async function assignRequired(db: TenantDb, courseId: number, opts: { dueAt?: Date }, actor?: number): Promise<{ assigned: TrainingAssignment[]; considered: number }> {
  const rows = await trainingStatus(db, { courseId });
  const due = rows.filter((r) => r.required && ["not_trained", "expired", "revision_changed", "failed"].includes(r.status) && r.openAssignmentId === null);
  const assigned = due.length ? await assignCourse(db, courseId, due.map((r) => r.userId), { dueAt: opts.dueAt, reason: "required for your role" }, actor) : [];
  return { assigned, considered: rows.filter((r) => r.required).length };
}

export interface CompleteInput {
  completedAt: Date;
  trainerName?: string;
  notes?: string;
  sessionId?: number;
}

/**
 * The one place a training assignment gets marked complete — used by the dedicated endpoint, the "Training Record" form's save hook
 * (forms.controller.ts) and session attendance, so they can't diverge. Fixes the expiry date and which version of the linked document
 * the person was trained on.
 */
export async function completeAssignment(db: TenantDb, assignmentId: number, input: CompleteInput, performedBy?: number): Promise<TrainingAssignment> {
  const [assignment] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.id, assignmentId)));
  if (!assignment) throw AppError.notFound("Training assignment");
  if (assignment.status === "completed") throw new AppError("This training is already recorded as completed.", 409);
  const course = await loadCourse(db, assignment.courseId);
  const [updated] = await db
    .update(trainingAssignments)
    .set({
      status: "completed",
      completedAt: input.completedAt,
      trainerName: input.trainerName,
      notes: input.notes,
      sessionId: input.sessionId,
      documentVersion: await documentVersionNow(db, course.documentId),
      expiresAt: course.validityMonths ? addMonths(input.completedAt, course.validityMonths) : null,
    })
    .where(eq(trainingAssignments.id, assignmentId))
    .returning();
  if (!updated) throw new AppError("Failed to complete training assignment", 500);
  await recordAuditTrail(db, { entityType: AUDIT_ASSIGNMENT, entityId: assignmentId, action: "status_change", changes: { action: "complete", trainerName: input.trainerName, completedAt: input.completedAt, sessionId: input.sessionId, expiresAt: updated.expiresAt }, performedBy });
  await publishEvent(WORKFLOW_STREAM, { module: "training", event: "completed", entityId: assignmentId, courseId: assignment.courseId });
  return updated;
}

// ---- Sessions -------------------------------------------------------------------------------------------------------------------------------------

const AUDIT_SESSION = "TrainingSession";
export type AttendanceEntry = { userId: number; status: "present" | "absent" | "excused"; notes?: string };

export interface SessionInput {
  courseId: number;
  title?: string;
  instructorId?: number;
  instructorName?: string;
  location?: string;
  capacity?: number;
  scheduledAt: Date;
  notes?: string;
  attendance?: AttendanceEntry[];
}

async function checkRoster(db: TenantDb, attendance: AttendanceEntry[], capacity: number | null | undefined) {
  const ids = attendance.map((a) => a.userId);
  if (new Set(ids).size !== ids.length) throw AppError.badRequest("Someone is on the attendance list twice.");
  await assertTenantUsers(db, ids);
  if (capacity && attendance.length > capacity) throw AppError.badRequest(`The session holds ${capacity} people and ${attendance.length} are listed.`);
}

export async function scheduleSession(db: TenantDb, input: SessionInput, actor?: number): Promise<TrainingSession> {
  const course = await loadCourse(db, input.courseId);
  if (!course.active) throw AppError.badRequest("This course is retired and can't be scheduled.");
  let instructorName = input.instructorName?.trim() || null;
  if (input.instructorId !== undefined) {
    const p = await assertTenantUsers(db, [input.instructorId]);
    instructorName = p.get(input.instructorId)!.name ?? p.get(input.instructorId)!.email;
  }
  const attendance = input.attendance ?? [];
  await checkRoster(db, attendance, input.capacity);
  const [session] = await db.insert(trainingSessions).values({ courseId: input.courseId, title: input.title, instructorId: input.instructorId, instructorName, location: input.location, capacity: input.capacity, scheduledAt: input.scheduledAt, attendance, notes: input.notes, createdBy: actor }).returning();
  await recordAuditTrail(db, { entityType: AUDIT_SESSION, entityId: session!.id, action: "create", changes: { event: "session_scheduled", courseId: input.courseId, scheduledAt: input.scheduledAt, instructorName, enrolled: attendance.length }, performedBy: actor });
  await publishEvent(WORKFLOW_STREAM, { module: "training", event: "session_scheduled", entityId: session!.id, courseId: input.courseId });
  return session!;
}

async function loadSession(db: TenantDb, id: number): Promise<TrainingSession> {
  const [s] = await db.select().from(trainingSessions).where(and(eq(trainingSessions.id, id)));
  if (!s) throw AppError.notFound("Training session");
  return s;
}

export async function updateSession(db: TenantDb, id: number, patch: Partial<Omit<SessionInput, "courseId">>, actor?: number): Promise<TrainingSession> {
  const s = await loadSession(db, id);
  if (s.status !== "scheduled") throw new AppError(`A ${s.status} session can't be changed.`, 409);
  const capacity = patch.capacity ?? s.capacity;
  if (patch.attendance) await checkRoster(db, patch.attendance, capacity);
  let instructorName = patch.instructorName !== undefined ? patch.instructorName.trim() || null : undefined;
  if (patch.instructorId !== undefined) {
    const p = await assertTenantUsers(db, [patch.instructorId]);
    instructorName = p.get(patch.instructorId)!.name ?? p.get(patch.instructorId)!.email;
  }
  const [updated] = await db
    .update(trainingSessions)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
      ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.instructorId !== undefined ? { instructorId: patch.instructorId } : {}),
      ...(instructorName !== undefined ? { instructorName } : {}),
      ...(patch.attendance ? { attendance: patch.attendance } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(trainingSessions.id, id)))
    .returning();
  await recordAuditTrail(db, { entityType: AUDIT_SESSION, entityId: id, action: "update", changes: { event: "session_updated", ...(patch.attendance ? { enrolled: patch.attendance.length } : {}), ...(patch.scheduledAt ? { scheduledAt: patch.scheduledAt } : {}) }, performedBy: actor });
  return updated!;
}

export async function cancelSession(db: TenantDb, id: number, reason: string, actor?: number): Promise<TrainingSession> {
  const s = await loadSession(db, id);
  if (s.status !== "scheduled") throw new AppError(`A ${s.status} session can't be cancelled.`, 409);
  if (reason.trim().length < 5) throw AppError.badRequest("Say why it is cancelled (at least 5 characters).");
  const [updated] = await db.update(trainingSessions).set({ status: "cancelled", notes: [s.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(trainingSessions.id, id)).returning();
  await recordAuditTrail(db, { entityType: AUDIT_SESSION, entityId: id, action: "status_change", changes: { event: "session_cancelled", reason: reason.trim() }, performedBy: actor });
  await publishEvent(WORKFLOW_STREAM, { module: "training", event: "session_cancelled", entityId: id, courseId: s.courseId });
  return updated!;
}

/**
 * Completes a session. Everyone marked present has their training recorded (their open assignment is completed, or one is created and
 * completed), and, when the course needs an evaluation, gets a pending competency evaluation so the evaluator has it to do.
 */
export async function completeSession(db: TenantDb, id: number, input: { attendance?: AttendanceEntry[]; notes?: string; completedAt?: Date }, actor?: number): Promise<{ session: TrainingSession; recorded: number }> {
  const s = await loadSession(db, id);
  if (s.status !== "scheduled") throw new AppError(`This session is already ${s.status}.`, 409);
  const attendance = input.attendance ?? s.attendance;
  if (attendance.length === 0) throw AppError.badRequest("Record who attended before completing the session.");
  await checkRoster(db, attendance, s.capacity);
  const course = await loadCourse(db, s.courseId);
  const completedAt = input.completedAt ?? new Date();
  const evaluationRequired = !!(course.requirements as CourseRequirements | null)?.evaluationRequired;

  let recorded = 0;
  for (const entry of attendance) {
    if (entry.status !== "present") continue;
    const [open] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.courseId, s.courseId), eq(trainingAssignments.userId, entry.userId), inArray(trainingAssignments.status, ["assigned", "in_progress"]))).orderBy(asc(trainingAssignments.id));
    const assignmentId = open?.id ?? (await db.insert(trainingAssignments).values({ courseId: s.courseId, userId: entry.userId, assignedBy: actor }).returning())[0]!.id;
    await completeAssignment(db, assignmentId, { completedAt, trainerName: s.instructorName ?? undefined, notes: entry.notes, sessionId: s.id }, actor);
    recorded += 1;
    if (evaluationRequired) {
      const [pending] = await db.select({ id: trainingCompetencies.id }).from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, s.courseId), eq(trainingCompetencies.userId, entry.userId), eq(trainingCompetencies.status, "pending")));
      if (!pending) await db.insert(trainingCompetencies).values({ userId: entry.userId, courseId: s.courseId, sessionId: s.id, status: "pending", createdBy: actor });
    }
  }
  const [session] = await db.update(trainingSessions).set({ status: "completed", completedAt, attendance, notes: input.notes ?? s.notes, updatedAt: new Date() }).where(eq(trainingSessions.id, id)).returning();
  await recordAuditTrail(db, { entityType: AUDIT_SESSION, entityId: id, action: "status_change", changes: { event: "session_completed", attended: recorded, absent: attendance.filter((a) => a.status === "absent").length, excused: attendance.filter((a) => a.status === "excused").length }, performedBy: actor });
  await publishEvent(WORKFLOW_STREAM, { module: "training", event: "session_completed", entityId: id, courseId: s.courseId });
  return { session: session!, recorded };
}

export async function listSessions(db: TenantDb, filters: { courseId?: number; status?: string } = {}) {
  const conditions = [];
  if (filters.courseId) conditions.push(eq(trainingSessions.courseId, filters.courseId));
  if (filters.status) conditions.push(eq(trainingSessions.status, filters.status as TrainingSession["status"]));
  const rows = await db.select({ session: trainingSessions, courseTitle: trainingCourses.title }).from(trainingSessions).innerJoin(trainingCourses, eq(trainingCourses.id, trainingSessions.courseId)).where(and(...conditions)).orderBy(desc(trainingSessions.scheduledAt));
  return rows.map((r) => ({ ...r.session, courseTitle: r.courseTitle, enrolled: r.session.attendance.length, attended: r.session.attendance.filter((a) => a.status === "present").length }));
}

export async function getSession(db: TenantDb, id: number) {
  const s = await loadSession(db, id);
  const course = await loadCourse(db, s.courseId);
  const ids = s.attendance.map((a) => a.userId);
  const people = ids.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(inArray(users.id, ids))) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return { ...s, courseTitle: course.title, attendees: s.attendance.map((a) => ({ ...a, name: byId.get(a.userId)?.name ?? null, email: byId.get(a.userId)?.email ?? null })) };
}

// ---- Competency -----------------------------------------------------------------------------------------------------------------------------------

const AUDIT_COMPETENCY = "TrainingCompetency";

export interface EvaluationInput {
  score?: number;
  criteria?: { name: string; result: "pass" | "fail" | "n/a"; notes?: string }[];
  notes?: string;
}

export interface DecideInput {
  status: "pass" | "fail";
  evaluation?: EvaluationInput;
  score?: number;
  notes?: string;
}

export interface EvaluatorActor {
  id: number;
  roleName: string | null;
}

const isAdmin = (a: EvaluatorActor) => a.roleName === "admin" || a.roleName === "platform_admin";

/** Applies a pass/fail decision to a row (which may be new or a pending one). Enforces the rules that make an evaluation mean something. */
function checkDecision(course: TrainingCourse, subjectUserId: number, input: DecideInput, actor: EvaluatorActor) {
  if (subjectUserId === actor.id && !isAdmin(actor)) throw AppError.forbidden("You can't evaluate your own competency — someone else has to.");
  const req = (course.requirements ?? {}) as CourseRequirements;
  const score = input.score ?? input.evaluation?.score;
  const criteria = input.evaluation?.criteria ?? [];
  if (input.status === "pass") {
    if (criteria.some((c) => c.result === "fail")) throw AppError.badRequest("A criterion failed, so this can't be recorded as a pass.");
    if (req.passingScore !== undefined && score !== undefined && score < req.passingScore) throw AppError.badRequest(`The score (${score}) is below the passing score (${req.passingScore}).`);
    if (req.passingScore !== undefined && score === undefined && criteria.length === 0) throw AppError.badRequest(`This course has a passing score of ${req.passingScore}: record the score or the criteria results.`);
  }
  return { score: score ?? null, evaluation: { ...(score !== undefined ? { score } : {}), ...(criteria.length ? { criteria } : {}), ...(input.evaluation?.notes ? { notes: input.evaluation.notes } : {}) } as Record<string, unknown> };
}

export async function createCompetency(db: TenantDb, input: { userId: number; courseId: number; sessionId?: number; status?: "pending" | "pass" | "fail"; evaluation?: EvaluationInput; score?: number; notes?: string }, actor: EvaluatorActor): Promise<TrainingCompetency> {
  const course = await loadCourse(db, input.courseId);
  await assertTenantUsers(db, [input.userId]);
  if (input.sessionId !== undefined) await loadSession(db, input.sessionId);
  const status = input.status ?? "pending";

  if (status === "pending") {
    const [existing] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, input.courseId), eq(trainingCompetencies.userId, input.userId), eq(trainingCompetencies.status, "pending")));
    if (existing) throw new AppError("There is already an evaluation waiting for this person on this course.", 409);
    const [row] = await db.insert(trainingCompetencies).values({ userId: input.userId, courseId: input.courseId, sessionId: input.sessionId, status: "pending", notes: input.notes, createdBy: actor.id }).returning();
    await recordAuditTrail(db, { entityType: AUDIT_COMPETENCY, entityId: row!.id, action: "create", changes: { event: "evaluation_requested", userId: input.userId, courseId: input.courseId }, performedBy: actor.id });
    return row!;
  }

  // A decision recorded directly resolves the evaluation that was waiting for this person, instead of leaving it pending beside it.
  const [waiting] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, input.courseId), eq(trainingCompetencies.userId, input.userId), eq(trainingCompetencies.status, "pending")));
  if (waiting) return decideCompetency(db, waiting.id, { status, evaluation: input.evaluation, score: input.score, notes: input.notes }, actor);

  const decided = checkDecision(course, input.userId, { status, evaluation: input.evaluation, score: input.score }, actor);
  const evaluatedAt = new Date();
  const [row] = await db
    .insert(trainingCompetencies)
    .values({ userId: input.userId, courseId: input.courseId, sessionId: input.sessionId, evaluatorId: actor.id, evaluation: decided.evaluation, status, score: decided.score, evaluatedAt, expiresAt: status === "pass" && course.validityMonths ? addMonths(evaluatedAt, course.validityMonths) : null, notes: input.notes, createdBy: actor.id })
    .returning();
  await afterDecision(db, row!, actor);
  return row!;
}

/** Fills in a pending evaluation. A decided one can't be changed: a re-evaluation is a new record. */
export async function decideCompetency(db: TenantDb, id: number, input: DecideInput, actor: EvaluatorActor): Promise<TrainingCompetency> {
  const [row] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.id, id)));
  if (!row) throw AppError.notFound("Competency evaluation");
  if (row.status !== "pending") throw new AppError("This evaluation has already been decided. Start a new evaluation to reassess.", 409);
  const course = await loadCourse(db, row.courseId);
  const decided = checkDecision(course, row.userId, input, actor);
  const evaluatedAt = new Date();
  const [updated] = await db
    .update(trainingCompetencies)
    .set({ status: input.status, evaluation: decided.evaluation, score: decided.score, evaluatorId: actor.id, evaluatedAt, expiresAt: input.status === "pass" && course.validityMonths ? addMonths(evaluatedAt, course.validityMonths) : null, notes: input.notes ?? row.notes })
    .where(eq(trainingCompetencies.id, id))
    .returning();
  await afterDecision(db, updated!, actor);
  return updated!;
}

async function afterDecision(db: TenantDb, row: TrainingCompetency, actor: EvaluatorActor) {
  await recordAuditTrail(db, { entityType: AUDIT_COMPETENCY, entityId: row.id, action: "status_change", changes: { event: row.status === "pass" ? "competency_passed" : "competency_failed", userId: row.userId, courseId: row.courseId, score: row.score, expiresAt: row.expiresAt, ...(row.userId === actor.id ? { selfEvaluated: true } : {}) }, performedBy: actor.id });
  await publishEvent(WORKFLOW_STREAM, { module: "training", event: row.status === "pass" ? "competency_passed" : "competency_failed", entityId: row.id, courseId: row.courseId });
}

export async function listCompetencies(db: TenantDb, filters: { userId?: number; courseId?: number; status?: string } = {}) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(trainingCompetencies.userId, filters.userId));
  if (filters.courseId) conditions.push(eq(trainingCompetencies.courseId, filters.courseId));
  if (filters.status) conditions.push(eq(trainingCompetencies.status, filters.status as TrainingCompetency["status"]));
  const rows = await db.select({ c: trainingCompetencies, courseTitle: trainingCourses.title, userName: users.name, userEmail: users.email }).from(trainingCompetencies).innerJoin(trainingCourses, eq(trainingCourses.id, trainingCompetencies.courseId)).innerJoin(users, eq(users.id, trainingCompetencies.userId)).where(and(...conditions)).orderBy(desc(trainingCompetencies.id));
  return rows.map((r) => ({ ...r.c, courseTitle: r.courseTitle, userName: r.userName, userEmail: r.userEmail }));
}

// ---- What needs attention, and telling people ------------------------------------------------------------------------------------------------------

export async function attention(db: TenantDb) {
  const rows = await trainingStatus(db);
  const rank: Record<string, number> = { failed: 0, expired: 1, overdue: 2, revision_changed: 3, awaiting_evaluation: 4, not_trained: 5, expiring_soon: 6 };
  return rows.filter((r) => (r.required || r.status !== "not_trained") && NEEDS_ACTION.includes(r.status)).sort((a, b) => rank[a.status]! - rank[b.status]! || (a.userName ?? a.email).localeCompare(b.userName ?? b.email));
}

const DIGEST_SUBJECT = "Training due";
const STATUS_LABEL: Record<string, string> = { failed: "FAILED evaluation", expired: "EXPIRED", overdue: "OVERDUE", revision_changed: "document revised, retraining needed", awaiting_evaluation: "awaiting evaluation", not_trained: "not trained", expiring_soon: "expires within 30 days" };

export async function notifyDue(db: TenantDb, opts: { dedupeHours?: number } = {}): Promise<{ items: number; notified: number; skipped: boolean }> {
  const items = await attention(db);
  if (items.length === 0) return { items: 0, notified: 0, skipped: false };
  if (opts.dedupeHours) {
    const since = new Date(Date.now() - opts.dedupeHours * 3_600_000);
    const [recent] = await db.select({ id: notificationLog.id }).from(notificationLog).where(and(like(notificationLog.subject, `${DIGEST_SUBJECT}%`), gte(notificationLog.createdAt, since))).limit(1);
    if (recent) return { items: items.length, notified: 0, skipped: true };
  }
  const lines = items.slice(0, 40).map((i) => `- ${i.userName ?? i.email}: ${i.courseTitle} — ${STATUS_LABEL[i.status]}${i.expiresAt ? ` (${i.expiresAt.toISOString().slice(0, 10)})` : ""}`);
  const notified = await notifyDepartment(db, { department: "quality", subject: `${DIGEST_SUBJECT}: ${items.length} item${items.length === 1 ? "" : "s"} need attention`, body: `${lines.join("\n")}${items.length > 40 ? `\n…and ${items.length - 40} more` : ""}`, relatedEntityType: AUDIT_ASSIGNMENT });
  return { items: items.length, notified, skipped: false };
}

export async function sweepTrainingDue(): Promise<{ tenants: number; notified: number }> {
  let tenantsSwept = 0;
  let notified = 0;
  try {
    const ids = await ownerDb.selectDistinct({ }).from(trainingCourses).where(eq(trainingCourses.active, true));
    for (const { tenantId } of ids) {
      try {
        const r = await notifyDue(ownerDb as unknown as TenantDb, { dedupeHours: 20 });
        tenantsSwept += 1;
        notified += r.notified;
      } catch (err) {
        logger.error("Training due sweep failed for a tenant", { err: String(err) });
      }
    }
  } catch (err) {
    logger.error("Training due sweep failed", { err: String(err) });
  }
  return { tenants: tenantsSwept, notified };
}

let sweepHandle: ReturnType<typeof setInterval> | null = null;
/** Once every six hours (each organization gets at most one digest per 20 hours). Idempotent. */
export function startTrainingSweep(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void sweepTrainingDue(), 3 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void sweepTrainingDue(), 6 * 3_600_000);
  sweepHandle.unref?.();
}
export function stopTrainingSweep(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}
