import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { erpReceivingDocuments } from "../../drizzle/schema/erp.js";
import { callLlmDetailed } from "../ai/llm-gateway.js";
import { riskAnalysisPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadTenantLlmOptions, recordAiSuggestion } from "../ai/ai.usage.js";

/**
 * POST /risk/:id/ai-analysis — read-only, mirrors requisitionAiJustifyHandler's
 * shape exactly: gathers the risk's real fields plus whatever real source
 * record it's linked to (NCR/Supplier/WorkOrder/Receiving), asks the LLM for
 * a severity/probability/mitigation/monitoring suggestion, and returns it as
 * a suggestion — nothing is written to the risk or a mitigation row here.
 * The user reviews/edits the result and applies it via the normal
 * PUT /risk/:id or POST /risk/:id/mitigation, passing this response's
 * suggestionId back so that write is logged as "ai_suggestion_accepted"
 * rather than a plain edit (see risk.controller.ts). Gated by the same
 * requireDepartmentAccess("risk") the rest of the router already applies —
 * no separate gate needed, matching work-orders/erp-requisitions' own
 * per-record AI actions.
 */
export const riskAiAnalysisHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const [risk] = await req.db!.select().from(riskAssessments).where(and(eq(riskAssessments.id, id), eq(riskAssessments.tenantId, tenantId)));
  if (!risk) throw AppError.notFound("Risk assessment");

  const { tenant, llmOptions } = await loadTenantLlmOptions(req.db!, tenantId);
  const limitError = await checkUsageLimit(req.db!, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  let source: Record<string, unknown> | null = null;
  if (risk.sourceType === "NCR" && risk.sourceId) {
    const [row] = await req.db!.select().from(ncr).where(eq(ncr.id, risk.sourceId));
    source = row ? { type: "NCR", title: row.title, description: row.description, status: row.status, severity: row.severity } : null;
  } else if (risk.sourceType === "Supplier" && risk.sourceId) {
    const [row] = await req.db!.select().from(suppliers).where(eq(suppliers.id, risk.sourceId));
    source = row ? { type: "Supplier", name: row.name, status: row.status } : null;
  } else if (risk.sourceType === "WorkOrder" && risk.sourceId) {
    const [row] = await req.db!.select().from(workOrders).where(eq(workOrders.id, risk.sourceId));
    source = row ? { type: "WorkOrder", status: row.status, quantityPlanned: row.quantityPlanned, quantityCompleted: row.quantityCompleted } : null;
  } else if (risk.sourceType === "Receiving" && risk.sourceId) {
    const [row] = await req.db!.select().from(erpReceivingDocuments).where(eq(erpReceivingDocuments.id, risk.sourceId));
    source = row ? { type: "Receiving", notes: row.notes, createdAt: row.createdAt } : null;
  }

  const inputData = {
    title: risk.title,
    description: risk.description,
    category: risk.category,
    department: risk.department,
    currentSeverity: risk.severity,
    currentProbability: risk.probability,
    source,
  };

  const result = await callLlmDetailed(riskAnalysisPrompt(inputData), { system: "You are AccuQual's risk management assistant.", ...llmOptions });

  let output: Record<string, unknown>;
  try {
    output = JSON.parse(result.text);
  } catch {
    output = { raw: result.text };
  }

  const saved = await recordAiSuggestion(req.db!, {
    tenantId,
    module: "risk",
    pipeline: "risk_analysis",
    input: { ...inputData, riskAssessmentId: risk.id },
    output,
    result,
    performedBy: req.user?.id,
  });

  res.json({ ...output, suggestionId: saved.id });
});
