import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { erpPurchaseRequisitions } from "../../drizzle/schema/erp.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { callLlmDetailed } from "../ai/llm-gateway.js";
import { prJustificationPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadTenantLlmOptions, recordAiSuggestion } from "../ai/ai.usage.js";
import { computeSupplierPerformance } from "../supplier/supplier.performance.js";

/**
 * POST /erp/requisitions/:id/ai-justify — read-only, drafts justification
 * text for a requisition from its real item/supplier/NCR context. Returns
 * the draft as a suggestion; it is NOT written to the requisition's
 * justification field here — the user reviews/edits it and saves via the
 * normal PATCH /erp/requisitions/:id (justification is one of its editable
 * fields), same "the model never writes QMS data directly" guarantee as
 * every other AI pipeline in this app.
 */
export const requisitionAiJustifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const [requisition] = await req.db!.select().from(erpPurchaseRequisitions).where(and(eq(erpPurchaseRequisitions.id, id), eq(erpPurchaseRequisitions.tenantId, tenantId)));
  if (!requisition) throw AppError.notFound("PurchaseRequisition");

  const { tenant, llmOptions } = await loadTenantLlmOptions(req.db!, tenantId);
  const limitError = await checkUsageLimit(req.db!, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const [item] = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.id, requisition.itemId));
  const supplier = requisition.supplierId ? (await req.db!.select().from(suppliers).where(eq(suppliers.id, requisition.supplierId)))[0] : null;
  const performance = requisition.supplierId ? await computeSupplierPerformance(req.db!, tenantId, requisition.supplierId) : null;
  const linkedNcr = requisition.linkedNcrId ? (await req.db!.select().from(ncr).where(eq(ncr.id, requisition.linkedNcrId)))[0] : null;

  const inputData = {
    item: item ? { sku: item.sku, description: item.description, minLevel: item.minLevel, maxLevel: item.maxLevel } : null,
    quantity: requisition.quantity,
    supplier: supplier ? { name: supplier.name, status: supplier.status, riskLevel: supplier.riskLevel } : null,
    supplierPerformance: performance,
    linkedNcr: linkedNcr ? { title: linkedNcr.title, status: linkedNcr.status, severity: linkedNcr.severity, description: linkedNcr.description } : null,
  };

  const result = await callLlmDetailed(prJustificationPrompt(inputData), { system: "You are AccuQual's purchasing justification engine.", ...llmOptions });

  const saved = await recordAiSuggestion(req.db!, {
    tenantId,
    module: "erp",
    pipeline: "pr_justification",
    input: { ...inputData, requisitionId: requisition.id },
    output: { justification: result.text },
    result,
    performedBy: req.user?.id,
  });

  res.json({ justification: result.text, suggestionId: saved.id });
});
