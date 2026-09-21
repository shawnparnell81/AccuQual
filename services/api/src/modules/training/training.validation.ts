import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";
import { rejectAiStubText, AI_STUB_REJECT_MESSAGE } from "../ai/ai.guardrails.js";

// Phase 4 AI guardrails: description is the real onInsert target of
// AiFieldAssistant's "Insert" button on the course editor — one of only 2
// other real sites Phase 0's CAPA data-integrity fix found besides CAPA's
// own rootCause, closed here.
const descriptionField = z.string().refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE).optional();

/** What a course asks of the people it applies to (stored as the course's requirements). */
export const requirementsSchema = z
  .object({
    evaluationRequired: z.boolean().optional(),
    passingScore: z.coerce.number().int().min(0).max(100).optional(),
    criteria: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
    instructions: z.string().max(4000).optional(),
  })
  .strict();

const courseFields = {
  requiredForRoleId: z.number().int().nullable().optional(),
  requiredForDepartment: z.string().trim().max(60).nullable().optional(),
  validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  requirements: requirementsSchema.optional(),
};

export const createCourseSchema = z.object({
  title: z.string().min(1),
  description: descriptionField,
  ...courseFields,
});

export const updateCourseSchema = z.object({
  title: z.string().min(1).optional(),
  description: descriptionField,
  documentId: z.number().int().nullable().optional(),
  active: z.boolean().optional(),
  ...courseFields,
});

export const assignSchema = z.object({
  userIds: z.array(z.number().int()).min(1),
  dueAt: reasonableDate.optional(),
});

export const assignRequiredSchema = z.object({ dueAt: reasonableDate.optional() });

export const completeAssignmentSchema = z.object({
  trainerName: z.string().optional(),
  notes: z.string().optional(),
});

const attendanceEntry = z.object({ userId: z.number().int().positive(), status: z.enum(["present", "absent", "excused"]), notes: z.string().max(1000).optional() });

export const createSessionSchema = z.object({
  courseId: z.number().int().positive(),
  title: z.string().trim().max(200).optional(),
  instructorId: z.number().int().positive().optional(),
  instructorName: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  capacity: z.coerce.number().int().positive().optional(),
  scheduledAt: reasonableDate,
  notes: z.string().max(4000).optional(),
  attendance: z.array(attendanceEntry).max(500).optional(),
});

export const updateSessionSchema = createSessionSchema.omit({ courseId: true }).partial();

export const completeSessionSchema = z.object({
  attendance: z.array(attendanceEntry).max(500).optional(),
  notes: z.string().max(4000).optional(),
  completedAt: reasonableDate.optional(),
});

export const cancelSessionSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

const evaluationSchema = z.object({
  score: z.coerce.number().min(0).max(100).optional(),
  criteria: z.array(z.object({ name: z.string().trim().min(1).max(200), result: z.enum(["pass", "fail", "n/a"]), notes: z.string().max(1000).optional() })).max(60).optional(),
  notes: z.string().max(4000).optional(),
});

export const createCompetencySchema = z.object({
  userId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  sessionId: z.number().int().positive().optional(),
  status: z.enum(["pending", "pass", "fail"]).optional(),
  evaluation: evaluationSchema.optional(),
  score: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(4000).optional(),
});

export const decideCompetencySchema = z.object({
  status: z.enum(["pass", "fail"]),
  evaluation: evaluationSchema.optional(),
  score: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(4000).optional(),
});
