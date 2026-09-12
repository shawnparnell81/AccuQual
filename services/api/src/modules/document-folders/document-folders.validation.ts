import { z } from "zod";

export const createDocumentFolderSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().int().optional(),
});

export const updateDocumentFolderSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.number().int().nullable().optional(),
  sortOrder: z.number().int().optional(),
  documentId: z.number().int().nullable().optional(),
});
