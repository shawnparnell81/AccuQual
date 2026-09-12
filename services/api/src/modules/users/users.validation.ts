import { z } from "zod";

// Mirrors Department in components/layout/navConfig.ts (web) and
// middleware/departmentAccess.ts — which nav dropdown's RWX rules a user gets.
export const departmentSchema = z.enum([
  "quality",
  "engineering",
  "production",
  "customer_service",
  "purchasing",
  "material_management",
]);

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  roleId: z.number().int().optional(),
  department: departmentSchema.nullable().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().optional(),
  roleId: z.number().int().nullable().optional(),
  department: departmentSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});
