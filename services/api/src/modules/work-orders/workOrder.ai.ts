import type { Request, Response } from "express";
import { and, eq, inArray, ne } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { callLlmDetailed } from "../ai/llm-gateway.js";
import { workOrderPlanPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadTenantLlmOptions, recordAiSuggestion } from "../ai/ai.usage.js";

function parseSuggestions(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * POST /work-orders/ai-plan — gated by requireDepartmentAccess("work_orders")
 * at the router, same as every other route on this router; being a POST, it
 * actually requires "edit" (Customer Service, or admin — see
 * departmentAccess.ts PERMISSION_MATRIX.work_orders), not merely "read", so
 * production/purchasing/quality/material_management can view suggestions
 * already on file but can't request a new one. Read-only itself: gathers
 * real open NCRs, below_min/overstock inventory items, disqualified/probation
 * suppliers, and existing open work orders, then asks the LLM to suggest
 * which work orders to create next. Nothing is written except the
 * ai_suggestions audit row — creating an actual work order is a separate,
 * explicit POST /work-orders call the user makes after reviewing the
 * suggestion, same "no autonomous action" guarantee as ai.assistant.ts.
 */
export const workOrderAiPlanHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { tenant, llmOptions } = await loadTenantLlmOptions(req.db!, tenantId);
  const limitError = await checkUsageLimit(req.db!, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const openNcrs = await req.db!.select({ id: ncr.id, title: ncr.title, status: ncr.status, severity: ncr.severity }).from(ncr).where(and(eq(ncr.tenantId, tenantId), ne(ncr.status, "closed")));

  const flaggedItems = await req
    .db!.select({ id: inventoryItems.id, sku: inventoryItems.sku, description: inventoryItems.description, state: inventoryItems.state, minLevel: inventoryItems.minLevel, maxLevel: inventoryItems.maxLevel })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.state, ["below_min", "overstock"])));

  const riskySuppliers = await req
    .db!.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.status, ["probation", "disqualified"])));

  const openWorkOrders = await req
    .db!.select({ id: workOrders.id, itemId: workOrders.itemId, status: workOrders.status, quantityPlanned: workOrders.quantityPlanned })
    .from(workOrders)
    .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.status, ["planned", "in_progress"])));

  const inputData = { openNcrs, flaggedInventoryItems: flaggedItems, riskySuppliers, openWorkOrders };
  const result = await callLlmDetailed(workOrderPlanPrompt(inputData), { system: "You are AccuQual's production planning engine.", ...llmOptions });
  const output = parseSuggestions(result.text);

  const saved = await recordAiSuggestion(req.db!, {
    tenantId,
    module: "work_order",
    pipeline: "work_order_planning",
    input: inputData,
    output: output as Record<string, unknown>,
    result,
    performedBy: req.user?.id,
  });

  res.json(saved);
});
