import { z } from "zod";

export const createCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  requiredForRoleId: z.number().int().optional(),
});

export const assignSchema = z.object({
  userId: z.number().int(),
  dueAt: z.coerce.date().optional(),
});
