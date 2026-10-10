import { z } from "zod";

const codeSchema = z.string().trim().min(1).max(80);

export const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: codeSchema.optional(),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: codeSchema.optional(),
});

export const switchSiteSchema = z.union([
  z.object({ siteId: z.number().int().positive() }),
  z.object({ scope: z.literal("all") }),
]);

export const changeRecordSiteSchema = z.object({
  entity: z.enum(["ncr", "capa", "audit", "complaint", "warranty", "validation_report", "iso_form", "qms_form", "built_fill"]),
  id: z.number().int().positive(),
  siteId: z.number().int().positive(),
});

export const replaceMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(500),
});
