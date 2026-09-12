import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { trainingCourses, trainingAssignments, type TrainingAssignment } from "../../drizzle/schema/training.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
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
  res.status(201).json(created);
});

export const getCourse = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [course] = await req.db!.select().from(trainingCourses).where(and(eq(trainingCourses.id, id), eq(trainingCourses.tenantId, req.tenantId!)));
  if (!course) throw AppError.notFound("Training course");
  res.json(course);
});

/** Only title/description/documentId are editable — linking a course's material to a real controlled document is the main reason this exists. */
export const updateCourse = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { title, description, documentId } = req.body as { title?: string; description?: string; documentId?: number | null };
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (documentId !== undefined) patch.documentId = documentId;

  const [updated] = await req
    .db!.update(trainingCourses)
    .set(patch)
    .where(and(eq(trainingCourses.id, id), eq(trainingCourses.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("Training course");
  res.json(updated);
});

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
      userEmail: users.email,
      userName: users.name,
    })
    .from(trainingAssignments)
    .leftJoin(users, eq(trainingAssignments.userId, users.id))
    .where(and(eq(trainingAssignments.courseId, courseId), eq(trainingAssignments.tenantId, req.tenantId!)));
  res.json(rows);
});

/** Assigns a course to one or more employees at once — one audit entry per employee for individual traceability. */
export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const courseId = Number(req.params.id);
  const tenantId = req.tenantId!;
  const { userIds, dueAt } = req.body as { userIds: number[]; dueAt?: Date };

  const [course] = await req.db!.select().from(trainingCourses).where(and(eq(trainingCourses.id, courseId), eq(trainingCourses.tenantId, tenantId)));
  if (!course) throw AppError.notFound("Training course");

  const created: TrainingAssignment[] = [];
  for (const userId of userIds) {
    const [assignment] = await req.db!.insert(trainingAssignments).values({ tenantId, courseId, userId, dueAt, assignedBy: req.user?.id }).returning();
    if (!assignment) continue;
    created.push(assignment);
    await recordAuditTrail(req.db!, {
      tenantId,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: assignment.id,
      action: "create",
      changes: { action: "assign", courseId, userId, dueAt },
      performedBy: req.user?.id,
    });
  }
  res.status(201).json(created);
});

/** Legacy: marks every assignment for this course complete at once. Kept working; the per-assignment flow below is the real completion path now. */
export const completeHandler = asyncHandler(async (req: Request, res: Response) => {
  const courseId = Number(req.params.id);
  const [updated] = await req
    .db!.update(trainingAssignments)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(trainingAssignments.courseId, courseId), eq(trainingAssignments.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("Training assignment");
  res.json(updated);
});

export interface CompleteAssignmentInput {
  completedAt: Date;
  trainerName?: string;
  notes?: string;
}

/**
 * The one place a training assignment gets marked complete — used by both
 * the dedicated endpoint (completeAssignmentHandler) and the "Training
 * Record" form's save hook (forms.controller.ts), so the two can't diverge.
 * Mirrors Calibration's createCalibrationEvent.
 */
export async function completeTrainingAssignment(
  db: TenantDb,
  tenantId: number,
  assignmentId: number,
  input: CompleteAssignmentInput,
  performedBy?: number
): Promise<TrainingAssignment> {
  const [assignment] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.id, assignmentId), eq(trainingAssignments.tenantId, tenantId)));
  if (!assignment) throw AppError.notFound("Training assignment");

  const [updated] = await db
    .update(trainingAssignments)
    .set({ status: "completed", completedAt: input.completedAt, trainerName: input.trainerName, notes: input.notes })
    .where(eq(trainingAssignments.id, assignmentId))
    .returning();
  if (!updated) throw new AppError("Failed to complete training assignment", 500);

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: assignmentId,
    action: "status_change",
    changes: { action: "complete", trainerName: input.trainerName, completedAt: input.completedAt },
    performedBy,
  });

  return updated;
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
      courseTitle: trainingCourses.title,
      documentId: trainingCourses.documentId,
    })
    .from(trainingAssignments)
    .leftJoin(trainingCourses, eq(trainingAssignments.courseId, trainingCourses.id))
    .where(and(eq(trainingAssignments.userId, userId), eq(trainingAssignments.tenantId, req.tenantId!)));
  res.json(rows);
});

/** Employees for the assignment picker (TrainingAssignmentModal) — every active user in the tenant. */
export const listEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, req.tenantId!), eq(users.isActive, true)));
  res.json(rows);
});
