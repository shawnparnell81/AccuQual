import { z } from "zod";

export const createDocumentSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
});

export const updateDocumentSchema = createDocumentSchema.partial();

export const addVersionSchema = z.object({
  fileUrl: z.string().min(1),
  changeNotes: z.string().optional(),
});
