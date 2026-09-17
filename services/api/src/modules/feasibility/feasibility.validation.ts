import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const FEASIBLE_VALUES = ["yes", "no", "partial"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const DETERMINATIONS = ["feasible_as_quoted", "feasible_with_conditions", "not_feasible"] as const;

const AREA_KEYS = ["design", "equipment", "supplyChain", "quality", "capacity", "regulatory", "financial"] as const;

/** One {area}Feasible/{area}RiskLevel/{area}Mitigation triple per fixed assessment row — see feasibility.ts's own schema comment. */
function areaFields() {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const area of AREA_KEYS) {
    shape[`${area}Feasible`] = z.enum(FEASIBLE_VALUES).optional();
    shape[`${area}RiskLevel`] = z.enum(RISK_LEVELS).optional();
    shape[`${area}Mitigation`] = z.string().optional();
  }
  return shape;
}

export const createFeasibilitySchema = z.object({
  customerId: z.coerce.number().int().optional(), // set when launched from the Customer Onboarding packet
  documentId: z.string().optional(),
  revision: z.string().optional(),
  effectiveDate: reasonableDate.optional(),
  processOwner: z.string().optional(),
  customerName: z.string().optional(),
  rfqQuoteNumber: z.string().optional(),
  partProjectName: z.string().optional(),
  partNumberRev: z.string().optional(),
  targetDeliveryDate: reasonableDate.optional(),
  annualEstimatedVolume: z.string().optional(),
});

// Every content field except the 5 sign-off rows — those go through their
// own narrower endpoint below. Deliberately excludes `status`/`finalizedAt`
// (only POST /:id/finalize sets those) — same "server-stamped, never
// client-writable" precedent as everywhere else in this app.
export const updateFeasibilitySchema = z.object({
  documentId: z.string().optional(),
  revision: z.string().optional(),
  effectiveDate: reasonableDate.nullable().optional(),
  processOwner: z.string().optional(),
  customerName: z.string().optional(),
  rfqQuoteNumber: z.string().optional(),
  partProjectName: z.string().optional(),
  partNumberRev: z.string().optional(),
  targetDeliveryDate: reasonableDate.nullable().optional(),
  annualEstimatedVolume: z.string().optional(),
  ...areaFields(),
  newToolingEquipment: z.string().optional(),
  inspectionGagingNeeds: z.string().optional(),
  specialCustomerRequirements: z.string().optional(),
  determination: z.enum(DETERMINATIONS).nullable().optional(),
  determinationNotes: z.string().optional(),
  providedDocuments: z.array(z.string().min(1)).optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
});

/**
 * One department's own sign-off row only — engineeringSignoffName/
 * Signature XOR qualitySignoffName/Signature XOR ... — enforced by
 * feasibility.controller.ts's assertSignoffFieldsAllowed, not by this
 * schema (zod validates shape, not "which fields together"). Dates are
 * never accepted here — server-stamped the moment a signature transitions
 * unset -> set.
 */
export const updateSignoffSchema = z.object({
  engineeringSignoffName: z.string().optional(),
  engineeringSignoffSignature: z.string().nullable().optional(),
  qualitySignoffName: z.string().optional(),
  qualitySignoffSignature: z.string().nullable().optional(),
  manufacturingSignoffName: z.string().optional(),
  manufacturingSignoffSignature: z.string().nullable().optional(),
  purchasingSignoffName: z.string().optional(),
  purchasingSignoffSignature: z.string().nullable().optional(),
  salesSignoffName: z.string().optional(),
  salesSignoffSignature: z.string().nullable().optional(),
});
