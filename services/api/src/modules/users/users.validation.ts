import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  roleId: z.number().int().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().optional(),
  roleId: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
});
