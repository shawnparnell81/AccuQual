import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";
import { QMS_FORM_DEFINITIONS } from "./qmsFormDefinitions.js";

const FORM_TYPES = QMS_FORM_DEFINITIONS.map((d) => d.formType) as [string, ...string[]];
export const QMS_FORM_STATUSES = ["draft", "active", "obsolete"] as const;

export const createQmsFormSchema = z.object({
  formType: z.enum(FORM_TYPES),
  formNo: z.string().optional(),
  revision: z.string().optional(),
  effectiveDate: reasonableDate.optional(),
  preparedBy: z.string().optional(),
  approvedBy: z.string().optional(),
});

export const updateQmsFormSchema = z.object({
  formNo: z.string().nullable().optional(),
  revision: z.string().nullable().optional(),
  effectiveDate: reasonableDate.nullable().optional(),
  preparedBy: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  status: z.enum(QMS_FORM_STATUSES).optional(),
  additionalComments: z.string().nullable().optional(),
});

// A row's real column keys vary per formType/section (see qmsFormDefinitions.ts)
// — validated against that definition in the controller, not here.
export const createQmsFormRowSchema = z.object({
  sectionKey: z.string().min(1),
  data: z.record(z.string(), z.string()).optional(),
});

export const updateQmsFormRowSchema = z.object({
  data: z.record(z.string(), z.string()),
});
