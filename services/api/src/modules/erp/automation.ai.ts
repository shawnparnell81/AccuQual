import type { Request, Response } from "express";
import { and, eq, inArray, desc } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { audits } from "../../drizzle/schema/audits.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { callLlm } from "../ai/llm-gateway.js";
import { erpAutomationPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadTenantLlmOptions } from "../ai/ai.usage.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

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
  const tenantId = req.tenantId!;
  const { tenant, llmOptions } = await loadTenantLlmOptions(req.db!, tenantId);
  const limitError = await checkUsageLimit(req.db!, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const belowMinItems = await req
    .db!.select({ id: inventoryItems.id, sku: inventoryItems.sku, description: inventoryItems.description, minLevel: inventoryItems.minLevel, defaultSupplierId: inventoryItems.defaultSupplierId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.state, "below_min")));

  const riskySuppliers = await req
    .db!.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status, riskLevel: suppliers.riskLevel })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.status, ["probation", "disqualified", "active"])));

  const recentAudits = await req
    .db!.select({ id: audits.id, name: audits.name, type: audits.type, status: audits.status })
    .from(audits)
    .where(eq(audits.tenantId, tenantId))
    .orderBy(desc(audits.id))
    .limit(20);

  const inputData = { belowMinItems, riskySuppliers, recentAudits };
  const raw = await callLlm(erpAutomationPrompt(inputData), { system: "You are AccuQual's ERP automation engine.", ...llmOptions });
  const output = parseSuggestions(raw);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId, module: "erp", pipeline: "erp_automation", input: inputData, output: output as Record<string, unknown>, createdBy: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "AiSuggestion",
    entityId: saved!.id,
    action: "create",
    changes: { module: "erp", pipeline: "erp_automation" },
    performedBy: req.user?.id,
  });

  res.json(saved);
});
