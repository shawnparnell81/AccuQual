import type { Request, Response } from "express";
import { and, eq, inArray, desc } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { audits } from "../../drizzle/schema/audits.js";
import { callLlmDetailed } from "../ai/llm-gateway.js";
import { erpAutomationPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadCompanyLlmOptions, recordAiSuggestion } from "../ai/ai.usage.js";

function parseSuggestions(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * POST /erp/ai-automation-suggestions — purchasing + material_management.
 * Read-only: gathers below_min inventory items, at-risk suppliers
 * (probation/disqualified/unrated), and recent audit coverage, then asks
 * the LLM to suggest concrete next actions. Each suggestion is typed
 * (create_requisition | flag_supplier | suggest_inspection) so the
 * frontend can route its "accept" button to the one real, existing
 * endpoint that type maps to (POST /erp/requisitions,
 * POST /suppliers/:id/conditional, POST /audits) — this endpoint itself
 * never creates or changes anything but its own ai_suggestions audit row.
 */
export const erpAutomationSuggestionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { co, llmOptions } = await loadCompanyLlmOptions(req.db!);
  const limitError = await checkUsageLimit(req.db!, co?.aiMonthlyLimit ?? null, co?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const belowMinItems = await req
    .db!.select({ id: inventoryItems.id, sku: inventoryItems.sku, description: inventoryItems.description, minLevel: inventoryItems.minLevel, defaultSupplierId: inventoryItems.defaultSupplierId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.state, "below_min")));

  const riskySuppliers = await req
    .db!.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status, riskLevel: suppliers.riskLevel })
    .from(suppliers)
    .where(and(inArray(suppliers.status, ["probation", "disqualified", "active"])));

  const recentAudits = await req
    .db!.select({ id: audits.id, name: audits.name, type: audits.type, status: audits.status })
    .from(audits)
    .orderBy(desc(audits.id))
    .limit(20);

  const inputData = { belowMinItems, riskySuppliers, recentAudits };
  const result = await callLlmDetailed(erpAutomationPrompt(inputData), { system: "You are AccuQual's ERP automation engine.", ...llmOptions });
  const output = parseSuggestions(result.text);

  const saved = await recordAiSuggestion(req.db!, {
    module: "erp",
    pipeline: "erp_automation",
    input: inputData,
    output: output as Record<string, unknown>,
    result,
    performedBy: req.user?.id,
    okVerb: "AI-suggested ERP actions",
  });

  res.json(saved);
});
