import { z } from "zod";
import { rejectAiStubText, AI_STUB_REJECT_MESSAGE } from "../ai/ai.guardrails.js";

// Phase 4 AI guardrails: description is the real onInsert target of
// AiFieldAssistant's "Insert" button on the course editor — one of only 2
// other real sites Phase 0's CAPA data-integrity fix found besides CAPA's
// own rootCause, closed here.
const descriptionField = z.string().refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE).optional();

export const createCourseSchema = z.object({
  title: z.string().min(1),
  description: descriptionField,
  requiredForRoleId: z.number().int().optional(),
});

export const updateCourseSchema = z.object({
  title: z.string().min(1).optional(),
  description: descriptionField,
  documentId: z.number().int().nullable().optional(),
});

export const assignSchema = z.object({
  userIds: z.array(z.number().int()).min(1),
  dueAt: z.coerce.date().optional(),
});

export const completeAssignmentSchema = z.object({
  trainerName: z.string().optional(),
  notes: z.string().optional(),
});
