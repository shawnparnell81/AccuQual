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
  // report:monthly-quality only.
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  replaceNotes: z.boolean().optional(),
});

const mappingEntrySchema = z.object({
  rule: z.enum(["label", "heading", "tableRow", "tableField", "named", "manual"]),
  source: z.string().max(300),
  column: z.string().max(80).optional(),
});

export const mappingBodySchema = z.object({
  targetRef: z.string().min(1).max(80),
  fileKind: z.enum(["docx", "xlsx", "csv"]),
  name: z.string().min(1).max(200),
  entries: z.record(z.string().max(80), mappingEntrySchema),
});

export const mappingUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  entries: z.record(z.string().max(80), mappingEntrySchema).optional(),
});
