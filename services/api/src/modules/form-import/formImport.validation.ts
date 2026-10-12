import { z } from "zod";

const valueSchema = z.union([z.string().max(8000), z.array(z.array(z.string().max(2000)).max(60)).max(600), z.null()]);

export const proposeBodySchema = z.object({
  targetRef: z.string().min(1).max(80),
  extracted: z.object({
    fileName: z.string().max(300),
    kind: z.enum(["docx", "xlsx", "csv"]),
    title: z.string().max(300).nullable(),
    blocks: z.array(z.unknown()).max(5000),
    sheets: z.array(z.unknown()).max(50),
    images: z.number().int().nonnegative(),
  }),
});

export const confirmImportSchema = z.object({
  targetRef: z.string().min(1).max(80),
  fileName: z.string().min(1).max(300),
  title: z.string().max(300).optional(),
  recordNumber: z.string().max(80).nullable().optional(),
  edited: z.number().int().nonnegative().max(1000).optional(),
  values: z.record(z.string().max(80), valueSchema),
});
