import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { trainingCourses, trainingAssignments } from "../../drizzle/schema/training.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";

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

export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const courseId = Number(req.params.id);
  const [course] = await req
    .db!.select()
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), eq(trainingCourses.tenantId, req.tenantId!)));
  if (!course) throw AppError.notFound("Training course");

  const [assignment] = await req
    .db!.insert(trainingAssignments)
    .values({ courseId, userId: req.body.userId, dueAt: req.body.dueAt, tenantId: req.tenantId! })
    .returning();
  res.status(201).json(assignment);
});

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
