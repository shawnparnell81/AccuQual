import { z } from "zod";

const codeSchema = z.string().trim().min(1).max(80);

export const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: codeSchema.optional(),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: codeSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const switchSiteSchema = z.object({
  siteId: z.number().int().positive(),
});

export const replaceMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(500),
});
