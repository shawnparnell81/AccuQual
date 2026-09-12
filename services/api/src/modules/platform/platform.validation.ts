import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "code must be lowercase alphanumeric with dashes"),
  adminEmail: z.string().email(),
  adminName: z.string().optional(),
  branding: z
    .object({
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      pdfHeader: z.string().optional(),
      pdfFooter: z.string().optional(),
    })
    .optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  branding: createTenantSchema.shape.branding,
});
