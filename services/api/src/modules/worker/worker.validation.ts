import { z } from "zod";
import { EMPLOYMENT_STATUSES } from "../../drizzle/schema/workerProfiles.js";

export const upsertWorkerProfileSchema = z.object({
  jobTitle: z.string().trim().max(120).nullable().optional(),
  shift: z.string().trim().max(60).nullable().optional(),
  hireDate: z.coerce.date().nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
