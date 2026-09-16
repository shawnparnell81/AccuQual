import { z } from "zod";

// Mirrors Department in components/layout/navConfig.ts (web) and
// middleware/departmentAccess.ts — which nav dropdown's RWX rules a user gets.
// Was missing "sales_and_marketing" (a real Department since the Sales &
// Marketing module shipped) — silently blocked assigning anyone to it via
// this API even though the department itself has real PERMISSION_MATRIX
// entries; fixed while touching this exact file for the Roles & Permissions
// module.
export const departmentSchema = z.enum([
  "quality",
  "engineering",
  "production",
  "customer_service",
  "purchasing",
  "material_management",
  "sales_and_marketing",
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

/** A user's own theme override — see users.themePreferences. "" clears a color back to following the tenant/default theme, same convention as tenant.validation.ts's updateBrandingSchema. */
export const updateMyThemeSchema = z.object({
  mode: z.enum(["light", "dark", "system"]).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c")
    .optional()
    .or(z.literal("")),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c")
    .optional()
    .or(z.literal("")),
});
