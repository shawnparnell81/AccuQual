import { z } from "zod";

export const ONBOARDING_DOCUMENT_TYPES = [
  "w9",
  "nda",
  "quality_manual",
  "process_flow",
  "control_plan",
  "fmea",
  "org_chart",
  "certification_iso",
  "certification_iatf",
  "certification_as9100",
  "questionnaire",
  "agreement",
] as const;

export const PPAP_DOCUMENT_TYPES = [
  "psw",
  "dfmea",
  "pfmea",
  "control_plan",
  "process_flow",
  "dimensional_results",
  "material_results",
  "initial_process_studies",
  "appearance_approval_report",
  "sample_parts",
  "packaging_specs",
] as const;

export const REVIEW_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
export const RESPONSE_REVIEW_STATUSES = ["submitted", "under_review", "accepted", "rejected"] as const;
export const MESSAGE_CATEGORIES = ["message", "follow_up", "request", "response"] as const;

export const uploadOnboardingDocumentSchema = z.object({
  documentType: z.enum(ONBOARDING_DOCUMENT_TYPES),
  // Internal staff only — a supplier login is always scoped to their own
  // supplierId server-side (see supplierPortal.controller.ts's
  // resolveSupplierScope), never accepted from their own request body.
  supplierId: z.coerce.number().int().optional(),
});

export const reviewOnboardingDocumentSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNotes: z.string().optional(),
});

export const uploadSupplierDocumentSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  supplierId: z.coerce.number().int().optional(),
});

export const submitPpapSchema = z.object({
  level: z.coerce.number().int().min(1).max(5),
  partNumber: z.string().optional(),
  description: z.string().optional(),
  supplierId: z.coerce.number().int().optional(),
});

export const reviewPpapSchema = z.object({
  status: z.enum(["approved", "rejected", "under_review"]),
  reviewNotes: z.string().optional(),
});

export const submitCorrectiveActionSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  linkedNcrId: z.coerce.number().int().optional(),
  linkedCapaId: z.coerce.number().int().optional(),
  problemDescription: z.string().optional(),
  containment: z.string().optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  preventiveAction: z.string().optional(),
  verification: z.string().optional(),
});

export const submit8dSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  linkedNcrId: z.coerce.number().int().optional(),
  linkedEightDId: z.coerce.number().int().optional(),
  d1_team: z.string().optional(),
  d2_problem: z.string().optional(),
  d3_containment: z.string().optional(),
  d4_rootCause: z.string().optional(),
  d5_correctiveAction: z.string().optional(),
  d6_validation: z.string().optional(),
  d7_prevention: z.string().optional(),
  d8_closure: z.string().optional(),
});

export const reviewResponseSchema = z.object({
  status: z.enum(RESPONSE_REVIEW_STATUSES),
  reviewNotes: z.string().optional(),
});

export const sendMessageSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  threadKey: z.string().optional(),
  body: z.string().min(1),
  category: z.enum(MESSAGE_CATEGORIES).optional(),
  aiDrafted: z.boolean().optional(),
});

export const sendMessageEmailSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  threadKey: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  category: z.enum(MESSAGE_CATEGORIES).optional(),
  aiDrafted: z.boolean().optional(),
});

export const updateSupplierSettingsSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
});
