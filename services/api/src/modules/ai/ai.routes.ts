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
} from "./ai.validation.js";
import { analyzeRootCause, generateCapa, generateEightD, riskScore, analysis, formSuggest, formAutofill } from "./ai.controller.js";

export const aiRouter = Router();
aiRouter.use(requireAuth, withTenantDb);

aiRouter.post("/root-cause", validate(rootCauseSchema), analyzeRootCause);
aiRouter.post("/capa", validate(capaSchema), generateCapa);
aiRouter.post("/8d", validate(eightDSchema), generateEightD);
aiRouter.post("/risk-score", validate(riskScoreSchema), riskScore);
aiRouter.post("/analysis", validate(analysisSchema), analysis);
aiRouter.post("/forms/suggest", validate(formSuggestSchema), formSuggest);
aiRouter.post("/forms/autofill", validate(formAutofillSchema), formAutofill);
