import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { trainingCourses, trainingAssignments, type TrainingAssignment } from "../../drizzle/schema/training.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import * as service from "./training.service.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";

// Distinct from "Document" and "DocumentFolder" — see those modules' own
// comments on why each entity keeps its own entityType.
const AUDIT_ENTITY_TYPE = "TrainingAssignment";

export const listCourses = asyncHandler(async (req: Request, res: Response) => {
  res.json(await req.db!.select().from(trainingCourses).where(eq(trainingCourses.tenantId, req.tenantId!)));
});

export const createCourse = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req.db!.insert(trainingCourses).values({ ...req.body, tenantId: req.tenantId! }).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "TrainingCourse", entityId: created!.id, action: "create", changes: { title: created!.title }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getCourse = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [course] = await req.db!.select().from(trainingCourses).where(and(eq(trainingCourses.id, id), eq(trainingCourses.tenantId, req.tenantId!)));
  if (!course) throw AppError.notFound("Training course");
  res.json(course);
});

/** Title, description, the linked document, who the course is required of, how long it stays valid, and what an evaluation checks. */
export const updateCourse = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { ...(req.body as Record<string, unknown>), updatedAt: new Date() };
  const [updated] = await req.db!.update(trainingCourses).set(patch).where(and(eq(trainingCourses.id, id), eq(trainingCourses.tenantId, req.tenantId!))).returning();
  if (!updated) throw AppError.notFound("Training course");
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "TrainingCourse", entityId: id, action: "update", changes: req.body as Record<string, unknown>, performedBy: req.user?.id });
  res.json(updated);
});

/** An open assignment past its due date reads as overdue (the stored status only ever says assigned / in progress / completed). */
function withEffectiveStatus<T extends { status: string; dueAt: Date | null }>(row: T): T {
  return (row.status === "assigned" || row.status === "in_progress") && row.dueAt && row.dueAt.getTime() < Date.now() ? { ...row, status: "overdue" } : row;
}

/** Assignments for one course, with the employee's email/name for display — used by TrainingDetailPage's assignment list. */
export const listAssignmentsForCourse = asyncHandler(async (req: Request, res: Response) => {
  const courseId = Number(req.params.id);
  const rows = await req
    .db!.select({
      id: trainingAssignments.id,
      courseId: trainingAssignments.courseId,
      userId: trainingAssignments.userId,
      status: trainingAssignments.status,
      dueAt: trainingAssignments.dueAt,
      completedAt: trainingAssignments.completedAt,
      trainerName: trainingAssignments.trainerName,
      notes: trainingAssignments.notes,
      certificatePath: trainingAssignments.certificatePath,
      expiresAt: trainingAssignments.expiresAt,
      documentVersion: trainingAssignments.documentVersion,
      sessionId: trainingAssignments.sessionId,
      userEmail: users.email,
      userName: users.name,
    })
    .from(trainingAssignments)
    .leftJoin(users, eq(trainingAssignments.userId, users.id))
    .where(and(eq(trainingAssignments.courseId, courseId), eq(trainingAssignments.tenantId, req.tenantId!)));
  res.json(rows.map(withEffectiveStatus));
});

/** Assigns a course to one or more employees at once — one audit entry and one notice per person; anyone who already has it open is skipped, and every person must belong to this organization. */
export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userIds, dueAt } = req.body as { userIds: number[]; dueAt?: Date };
  res.status(201).json(await service.assignCourse(req.db!, req.tenantId!, Number(req.params.id), userIds, { dueAt }, req.user?.id));
});

/**
 * The old bulk completion marked EVERY assignment of a course complete in one call, with no record of who actually did the
 * training. Completion is now per person (POST /training/assignment/:id/complete) or through a session's attendance.
 */
export const completeHandler = asyncHandler(async (_req: Request, _res: Response) => {
  throw new AppError("This endpoint has been replaced: record each person's training with POST /training/assignment/:id/complete, or complete a session with its attendance (POST /training/session/:id/complete).", 410);
});

export interface CompleteAssignmentInput {
  completedAt: Date;
  trainerName?: string;
  notes?: string;
}

/** Used by the dedicated endpoint and the "Training Record" form's save hook (forms.controller.ts); the rules live in training.service.ts. */
export function completeTrainingAssignment(db: TenantDb, tenantId: number, assignmentId: number, input: CompleteAssignmentInput, performedBy?: number): Promise<TrainingAssignment> {
  return service.completeAssignment(db, tenantId, assignmentId, input, performedBy);
}

export const completeAssignmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { trainerName, notes } = req.body as { trainerName?: string; notes?: string };
  const updated = await completeTrainingAssignment(req.db!, req.tenantId!, Number(req.params.assignmentId), { completedAt: new Date(), trainerName, notes }, req.user?.id);
  res.json(updated);
});

export const uploadCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const assignmentId = Number(req.params.assignmentId);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  const [assignment] = await req.db!.select().from(trainingAssignments).where(and(eq(trainingAssignments.id, assignmentId), eq(trainingAssignments.tenantId, tenantId)));
  if (!assignment) throw AppError.notFound("Training assignment");

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${tenantId}/forms/custom/training-certs`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${assignmentId}-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  if (assignment.certificatePath && existsSync(assignment.certificatePath)) {
    await unlink(assignment.certificatePath).catch((err) => logger.warn(`Could not remove replaced certificate file ${assignment.certificatePath}`, err));
  }

  const [updated] = await req.db!.update(trainingAssignments).set({ certificatePath: path }).where(eq(trainingAssignments.id, assignmentId)).returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: assignmentId,
    action: "update",
    changes: { action: "upload_certificate", filename: file.originalname },
    performedBy: req.user?.id,
  });

  res.status(201).json(updated);
});

export const downloadCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const assignmentId = Number(req.params.assignmentId);
  const [assignment] = await req.db!.select().from(trainingAssignments).where(and(eq(trainingAssignments.id, assignmentId), eq(trainingAssignments.tenantId, tenantId)));
  if (!assignment) throw AppError.notFound("Training assignment");
  if (!assignment.certificatePath || !existsSync(assignment.certificatePath)) throw AppError.notFound("Certificate file");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="training-${assignmentId}-certificate.pdf"`);
  createReadStream(assignment.certificatePath).pipe(res);
});

/** Every training record for one employee, across every course — the data behind TrainingHistoryPanel. */
export const employeeHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const rows = await req
    .db!.select({
      id: trainingAssignments.id,
      courseId: trainingAssignments.courseId,
      status: trainingAssignments.status,
      dueAt: trainingAssignments.dueAt,
      completedAt: trainingAssignments.completedAt,
      trainerName: trainingAssignments.trainerName,
      notes: trainingAssignments.notes,
      certificatePath: trainingAssignments.certificatePath,
      expiresAt: trainingAssignments.expiresAt,
      courseTitle: trainingCourses.title,
      documentId: trainingCourses.documentId,
    })
    .from(trainingAssignments)
    .leftJoin(trainingCourses, eq(trainingAssignments.courseId, trainingCourses.id))
    .where(and(eq(trainingAssignments.userId, userId), eq(trainingAssignments.tenantId, req.tenantId!)));
  res.json(rows.map(withEffectiveStatus));
});

/** Employees for the assignment picker (TrainingAssignmentModal) — every active user in the tenant. */
export const listEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, req.tenantId!), eq(users.isActive, true)));
  res.json(rows);
});
