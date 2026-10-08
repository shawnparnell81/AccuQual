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

export const updateFormNumberSchema = z.object({
  formId: z.string().max(40),
});

export const fileFormRecordSchema = z.object({
  formKey: z.string().min(1),
  recordId: z.number().int().positive(),
  folderId: z.number().int().positive(),
  partNumber: z.string().trim().max(80).optional(),
});

export const renameFormFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const retireFolderSchema = z.object({
  destinationId: z.number().int().positive().nullable().optional(),
});
