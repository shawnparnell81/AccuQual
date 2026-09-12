import { z } from "zod";

export const createCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  requiredForRoleId: z.number().int().optional(),
});

export const updateCourseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  documentId: z.number().int().nullable().optional(),
});

export const assignSchema = z.object({
  userIds: z.array(z.number().int()).min(1),
  dueAt: z.coerce.date().optional(),
});

export const completeAssignmentSchema = z.object({
  trainerName: z.string().optional(),
  notes: z.string().optional(),
});
