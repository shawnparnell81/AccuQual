import type { Request, Response } from "express";
import { aiSuggestions, aiRiskScores } from "../../drizzle/schema/ai.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import * as pipelines from "./ai.pipelines.js";

/** AI Root Cause Controller — mirrors the AccuQual Backend Spec §4 example. */
export const analyzeRootCause = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, ncrData } = req.body;
  const suggestion = await pipelines.runRootCausePipeline(ncrData);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "ncr", pipeline: "root_cause", input: { ncrId, ncrData }, output: suggestion, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});

export const generateCapa = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, rootCause, ncrData } = req.body;
  const plan = await pipelines.runCapaGeneratorPipeline(rootCause, ncrData);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "capa", pipeline: "capa_generator", input: { ncrId, rootCause, ncrData }, output: plan, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});

export const generateEightD = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, ncrData, capaData } = req.body;
  const draft = await pipelines.runEightDGeneratorPipeline(ncrData, capaData);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "8d", pipeline: "eight_d_generator", input: { ncrId, ncrData, capaData }, output: draft, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});

export const riskScore = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId, input } = req.body;
  const result = (await pipelines.runRiskScoringPipeline(input)) as { score?: number };

  const [saved] = await req
    .db!.insert(aiRiskScores)
    .values({ tenantId: req.tenantId!, entityType, entityId, score: String(result.score ?? 0), details: result })
    .returning();
  res.json(saved);
});

export const formSuggest = asyncHandler(async (req: Request, res: Response) => {
  const { formType, partialData } = req.body;
  const output = await pipelines.runFormSuggestPipeline(formType, partialData);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "form", pipeline: "form_suggest", input: { formType, partialData }, output, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});

export const formAutofill = asyncHandler(async (req: Request, res: Response) => {
  const { formType, context } = req.body;
  const output = await pipelines.runFormAutofillPipeline(formType, context);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "form", pipeline: "form_autofill", input: { formType, context }, output, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});

export const analysis = asyncHandler(async (req: Request, res: Response) => {
  const { kind, input } = req.body;

  let output: Record<string, unknown>;
  switch (kind) {
    case "audit_prep":
      output = await pipelines.runAuditPrepPipeline(input);
      break;
    case "document_summary":
      output = await pipelines.runDocumentSummaryPipeline(String(input));
      break;
    case "predictive_quality":
      output = await pipelines.runPredictiveQualityPipeline(input);
      break;
    default:
      throw AppError.badRequest("Unsupported analysis kind");
  }

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId: req.tenantId!, module: "analysis", pipeline: kind, input: { input }, output, createdBy: req.user?.id })
    .returning();
  res.json(saved);
});
