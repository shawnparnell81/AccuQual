import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import {
  rootCauseSchema,
  capaSchema,
  eightDSchema,
  riskScoreSchema,
  analysisSchema,
  formSuggestSchema,
  formAutofillSchema,
  ncrTriageSchema,
  supplierMessageDraftSchema,
  warrantyTriageSchema,
  inspectionNotesSchema,
  suggestionDecisionSchema,
} from "./ai.validation.js";
import {
  analyzeRootCause,
  generateCapa,
  generateEightD,
  riskScore,
  analysis,
  formSuggest,
  formAutofill,
  ncrTriage,
  supplierMessageDraft,
  warrantyTriage,
  inspectionNotes,
  recordSuggestionDecision,
} from "./ai.controller.js";
import { assistantSchema } from "./ai.validation.js";
import { assistantHandler } from "./ai.assistant.js";

export const aiRouter = Router();
aiRouter.use(requireAuth, withTenantDb);

// No department gate — same as every other route on this router already
// (root-cause/capa/8d/... have never been department-restricted), and
// explicitly required for the assistant: "must work for ANY user in ANY
// department".
aiRouter.post("/assistant", validate(assistantSchema), assistantHandler);

aiRouter.post("/root-cause", validate(rootCauseSchema), analyzeRootCause);
aiRouter.post("/capa", validate(capaSchema), generateCapa);
aiRouter.post("/8d", validate(eightDSchema), generateEightD);
aiRouter.post("/risk-score", validate(riskScoreSchema), riskScore);
aiRouter.post("/analysis", validate(analysisSchema), analysis);
aiRouter.post("/forms/suggest", validate(formSuggestSchema), formSuggest);
aiRouter.post("/forms/autofill", validate(formAutofillSchema), formAutofill);

// Phase 4 — new module-level integration points, same no-department-gate
// convention every other /ai/* endpoint already uses.
aiRouter.post("/ncr-triage", validate(ncrTriageSchema), ncrTriage);
aiRouter.post("/supplier-message-draft", validate(supplierMessageDraftSchema), supplierMessageDraft);
aiRouter.post("/warranty-triage", validate(warrantyTriageSchema), warrantyTriage);
// Phase 8 — "AI-assisted inspection notes."
aiRouter.post("/inspection-notes", validate(inspectionNotesSchema), inspectionNotes);

// Phase 5 — explicit accept/reject on an already-generated suggestion.
aiRouter.post("/suggestions/:id/decision", validate(suggestionDecisionSchema), recordSuggestionDecision);
