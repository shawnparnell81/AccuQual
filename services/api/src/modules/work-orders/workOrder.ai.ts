import type { Request, Response } from "express";
import { and, eq, inArray, ne } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { callLlm } from "../ai/llm-gateway.js";
import { workOrderPlanPrompt } from "../ai/prompts.js";
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
 * POST /work-orders/ai-plan — production + purchasing (matching the
 * module's own PERMISSION_MATRIX access). Read-only: gathers real open
 * NCRs, below_min/overstock inventory items, disqualified/probation
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
  const raw = await callLlm(workOrderPlanPrompt(inputData), { system: "You are AccuQual's production planning engine.", ...llmOptions });
  const output = parseSuggestions(raw);

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId, module: "work_order", pipeline: "work_order_planning", input: inputData, output: output as Record<string, unknown>, createdBy: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "AiSuggestion",
    entityId: saved!.id,
    action: "create",
    changes: { module: "work_order", pipeline: "work_order_planning" },
    performedBy: req.user?.id,
  });

  res.json(saved);
});
