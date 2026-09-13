import type { Request, Response } from "express";
import { and, eq, gte } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { callLlmDetailed } from "./llm-gateway.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { inventoryItems, inventoryStock, inventoryMovements } from "../../drizzle/schema/inventory.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { digitalTwinModels, digitalTwinSimulations } from "../../drizzle/schema/digitalTwin.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { trainingCourses, trainingAssignments } from "../../drizzle/schema/training.js";
import { equipment, calibrations } from "../../drizzle/schema/calibration.js";
import { computeSupplierPerformance } from "../supplier/supplier.performance.js";
import { computeCostingSummary } from "../inventory/inventory.costing.js";
import { decryptSecret } from "../tenant/crypto.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import type { TenantDb } from "../../lib/tenantScope.js";

/**
 * The one hard safety guarantee here is structural, not the system prompt:
 * this handler never calls an insert/update/delete on anything but
 * audit_trail (its own usage log). Whatever the model says, there is no
 * code path here that could act on it — "the assistant can't modify
 * records" is enforced by this endpoint simply having no write capability
 * to modify, not by trusting the model to follow instructions. The system
 * prompt below is a second, best-effort layer on top of that, not the
 * real guarantee.
 */
const SAFETY_PREAMBLE =
  "You are a read-only assistant for AccuQual, a quality management system. " +
  "You can summarize data, explain fields, and suggest text or next steps. " +
  "You cannot modify records, change workflow states, delete anything, or take any action — " +
  "you only ever produce a text response for the user to read and act on themselves.";

/**
 * Real, read-only context for a small, representative set of modules
 * (ncr/capa/inventory, plus audit/digital_twin added for the module
 * assistance round). Any other module name still gets passed through as a
 * plain label, honestly, rather than silently dropped or faked.
 */
async function loadContextSummary(db: TenantDb, tenantId: number, module: string, recordId?: number): Promise<string | null> {
  if (recordId === undefined) return `The user is currently viewing the ${module} module (no specific record selected).`;

  if (module === "ncr") {
    const [row] = await db.select().from(ncr).where(and(eq(ncr.id, recordId), eq(ncr.tenantId, tenantId)));
    if (!row) return null;
    return `The user is viewing NCR #${row.id}: "${row.title}". Status: ${row.status}. Severity: ${row.severity ?? "not set"}. Description: ${row.description ?? "none"}.`;
  }
  if (module === "capa") {
    const [row] = await db.select().from(capa).where(and(eq(capa.id, recordId), eq(capa.tenantId, tenantId)));
    if (!row) return null;
    return `The user is viewing CAPA #${row.id} (linked NCR #${row.ncrId ?? "none"}). Status: ${row.status}. Root cause: ${row.rootCause ?? "not documented yet"}. Action plan: ${row.actionPlan ?? "not documented yet"}.`;
  }
  if (module === "inventory") {
    const [row] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, recordId), eq(inventoryItems.tenantId, tenantId)));
    if (!row) return null;
    return `The user is viewing inventory item "${row.sku}" (${row.description ?? "no description"}). State: ${row.state}. Min level: ${row.minLevel}. Max level: ${row.maxLevel ?? "not set"}.`;
  }
  if (module === "supplier") {
    const [row] = await db.select().from(suppliers).where(and(eq(suppliers.id, recordId), eq(suppliers.tenantId, tenantId)));
    if (!row) return null;
    return `The user is viewing Supplier "${row.name}" (status: ${row.status}, recorded risk level: ${row.riskLevel ?? "not set"}). Contact: ${row.contactEmail ?? "none"}.`;
  }
  if (module === "training") {
    const [row] = await db.select().from(trainingCourses).where(and(eq(trainingCourses.id, recordId), eq(trainingCourses.tenantId, tenantId)));
    if (!row) return null;
    const assignments = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.courseId, recordId), eq(trainingAssignments.tenantId, tenantId)));
    const completed = assignments.filter((a) => a.status === "completed").length;
    const overdue = assignments.filter((a) => a.status === "overdue").length;
    const inProgress = assignments.filter((a) => a.status === "in_progress").length;
    const notStarted = assignments.filter((a) => a.status === "assigned").length;
    return (
      `The user is viewing Training Course "${row.title}". Description: ${row.description ?? "none"}. ` +
      `Assignments: ${assignments.length} total — ${completed} completed, ${overdue} overdue, ${inProgress} in progress, ${notStarted} not started yet.`
    );
  }
  if (module === "calibration") {
    const [row] = await db.select().from(equipment).where(and(eq(equipment.id, recordId), eq(equipment.tenantId, tenantId)));
    if (!row) return null;
    const events = await db.select().from(calibrations).where(and(eq(calibrations.equipmentId, recordId), eq(calibrations.tenantId, tenantId)));
    const latest = events.length > 0 ? events.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b)) : null;
    return (
      `The user is viewing Equipment "${row.name}" (serial: ${row.serialNumber ?? "none"}, location: ${row.location ?? "none"}). ` +
      `Calibration interval: ${row.calibrationIntervalDays} days. ${events.length} calibration event(s) recorded. ` +
      (latest
        ? `Most recent: ${new Date(latest.performedAt).toISOString().slice(0, 10)}, result: ${latest.result ?? "not recorded"}, next due: ${latest.nextDueAt ? new Date(latest.nextDueAt).toISOString().slice(0, 10) : "not set"}.`
        : "No calibration events recorded yet.")
    );
  }
  if (module === "audit") {
    const [row] = await db.select().from(audits).where(and(eq(audits.id, recordId), eq(audits.tenantId, tenantId)));
    if (!row) return null;
    const items = await db.select().from(auditItems).where(and(eq(auditItems.auditId, recordId), eq(auditItems.tenantId, tenantId)));
    const findings = items.filter((i) => i.finding).map((i) => `[${i.severity ?? "observation"}] ${i.finding}`);
    return (
      `The user is viewing Audit #${row.id} "${row.name}" (type: ${row.type ?? "not set"}). Status: ${row.status}. ` +
      `${items.length} audit item(s) recorded so far. ` +
      (findings.length > 0 ? `Findings so far: ${findings.slice(0, 10).join("; ")}.` : "No findings recorded yet.")
    );
  }
  if (module === "digital_twin") {
    // recordId here is a digital_twin_simulations id (a saved simulation
    // run), not a model id — that's the real "record" a simulation-results
    // view is showing.
    const [sim] = await db.select().from(digitalTwinSimulations).where(and(eq(digitalTwinSimulations.id, recordId), eq(digitalTwinSimulations.tenantId, tenantId)));
    if (!sim) return null;
    const [model] = await db.select().from(digitalTwinModels).where(and(eq(digitalTwinModels.id, sim.modelId), eq(digitalTwinModels.tenantId, tenantId)));
    const results = sim.results as {
      predictedDefectRatePct?: number;
      bottleneck?: { nodeId: string; utilizationPct: number } | null;
      riskHeatmap?: Array<{ nodeId: string; riskScore: number }>;
      recommendedActions?: string[];
    } | null;
    return (
      `The user is viewing Digital Twin simulation #${sim.id} of model "${model?.name ?? `#${sim.modelId}`}". ` +
      `Input parameters: ${JSON.stringify(sim.inputParameters ?? {})}. ` +
      `Predicted defect rate: ${results?.predictedDefectRatePct ?? "unknown"}%. ` +
      `Bottleneck: ${results?.bottleneck ? `${results.bottleneck.nodeId} at ${results.bottleneck.utilizationPct}% utilization` : "none"}. ` +
      `Risk heatmap: ${JSON.stringify(results?.riskHeatmap ?? [])}.`
    );
  }

  if (module === "capa_effectiveness") {
    const [row] = await db.select().from(capa).where(and(eq(capa.id, recordId), eq(capa.tenantId, tenantId)));
    if (!row) return null;
    let ncrSummary = "no linked NCR.";
    if (row.ncrId !== null) {
      const [ncrRow] = await db.select().from(ncr).where(and(eq(ncr.id, row.ncrId), eq(ncr.tenantId, tenantId)));
      if (ncrRow) {
        ncrSummary =
          `NCR #${ncrRow.id} "${ncrRow.title}" (severity: ${ncrRow.severity ?? "not set"}, status: ${ncrRow.status}). ` +
          `Description: ${ncrRow.description ?? "none"}. Containment: ${ncrRow.containment ?? "none"}.`;
      }
    }
    // No formal recurrence tracking exists anywhere in this schema (no
    // NCR "reopened" state, no category/root-cause code to group by) — the
    // one real recurrence signal available is whether more than one CAPA
    // was ever opened against the same NCR.
    const siblingCapas = row.ncrId !== null ? await db.select().from(capa).where(and(eq(capa.ncrId, row.ncrId), eq(capa.tenantId, tenantId))) : [];
    return (
      `The user is scoring the effectiveness of CAPA #${row.id}. Linked NCR: ${ncrSummary} ` +
      `CAPA status: ${row.status}. Root cause: ${row.rootCause ?? "not documented"}. Action plan: ${row.actionPlan ?? "not documented"}. ` +
      `Preventive action: ${row.preventiveAction ?? "not documented"}. Verification notes: ${row.verification ?? "not documented"}. ` +
      `Closed at: ${row.closedAt ? new Date(row.closedAt).toISOString() : "not closed yet"}. ` +
      (siblingCapas.length > 1
        ? `Note: ${siblingCapas.length} CAPAs total have been opened against this same NCR, which may itself be a sign of recurrence. `
        : "Only one CAPA has ever been opened against this NCR. ") +
      "AccuQual tracks no other recurrence metric — judge recurrence risk from the text above, not a computed statistic."
    );
  }
  if (module === "supplier_risk") {
    const [row] = await db.select().from(suppliers).where(and(eq(suppliers.id, recordId), eq(suppliers.tenantId, tenantId)));
    if (!row) return null;
    const performance = await computeSupplierPerformance(db, tenantId, recordId);
    const costing = await computeCostingSummary(db, tenantId, 30);
    const costEntry = costing.supplierCostDistribution.find((c) => c.supplierId === recordId);
    return (
      `The user is assessing risk for Supplier "${row.name}" (status: ${row.status}, current recorded risk level: ${row.riskLevel ?? "not set"}). ` +
      `Linked inventory items: ${performance.itemCount}. Avg delivery time: ${performance.deliveryTimeliness.avgDays ?? "no data"} day(s) ` +
      `(sample size ${performance.deliveryTimeliness.sampleSize}). Avg delivery accuracy: ${performance.deliveryAccuracy.avgPercent ?? "no data"}%. ` +
      `Overdue pending reorder requests: ${performance.reorderResponsiveness.overduePendingCount}. Below-min alerts triggered by this supplier's items: ${performance.belowMinAlertCount}. ` +
      `AccuQual's own rule-based risk score for this supplier: ${performance.riskScore} (${performance.riskPoints}/8 points). ` +
      (costEntry
        ? `Cost impact (last 30 days): $${costEntry.scrapCost.toFixed(2)} scrap, $${costEntry.consumptionCost.toFixed(2)} consumption, $${costEntry.itemValue.toFixed(2)} on-hand inventory value across ${costEntry.itemCount} costed item(s). `
        : "No costed inventory items are linked to this supplier, so no cost-impact figures are available. ") +
      "Note: AccuQual's data model does not link NCRs to suppliers, so no NCR history for this supplier can be provided — do not assume or invent one."
    );
  }
  if (module === "inventory_forecast") {
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, recordId), eq(inventoryItems.tenantId, tenantId)));
    if (!item) return null;
    const stockRows = await db.select().from(inventoryStock).where(and(eq(inventoryStock.itemId, recordId), eq(inventoryStock.tenantId, tenantId)));
    const onHand = stockRows.reduce((sum, r) => sum + Number(r.onHand), 0);
    const windowDays = 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.itemId, recordId), eq(inventoryMovements.tenantId, tenantId), gte(inventoryMovements.performedAt, since)));
    const sumType = (type: string) => movements.filter((m) => m.movementType === type).reduce((s, m) => s + Number(m.quantity), 0);
    const consumed = sumType("consume");
    const received = sumType("receive");
    const scrapped = sumType("scrap");
    const dailyConsumption = consumed / windowDays;
    const dailyReceiving = received / windowDays;
    const netBurnPerDay = dailyConsumption - dailyReceiving;
    const stockoutDays = netBurnPerDay > 0 ? Math.round(onHand / netBurnPerDay) : null;
    return (
      `The user is reviewing forecasting for inventory item "${item.sku}" (${item.description ?? "no description"}). ` +
      `Current on-hand: ${onHand} ${item.unitOfMeasure ?? "units"}. Min level: ${item.minLevel}, Max level: ${item.maxLevel ?? "not set"}, ` +
      `Reorder quantity: ${item.reorderQuantity ?? "not set"}, Lead time: ${item.leadTimeDays ?? "not set"} day(s). ` +
      `Over the last ${windowDays} days: ${consumed} consumed, ${received} received, ${scrapped} scrapped. ` +
      `Average daily consumption: ${dailyConsumption.toFixed(2)}, average daily receiving: ${dailyReceiving.toFixed(2)}, net burn rate: ${netBurnPerDay.toFixed(2)}/day. ` +
      (stockoutDays !== null
        ? `At this net burn rate, on-hand stock would be exhausted in approximately ${stockoutDays} day(s) if nothing changes. `
        : "Net burn rate is zero or negative (receiving is keeping pace with or exceeding consumption), so no stockout is currently projected from this trend. ") +
      `Current computed state: ${item.state}.`
    );
  }

  return `The user is currently viewing the ${module} module, record #${recordId}.`;
}

interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/** One string prompt, not a real multi-turn messages array — the shared LLM gateway (used by 8 other real pipelines) only ever takes one prompt string per call; this flattens the client-held transcript into it rather than changing that shared contract for every other caller. */
function flattenConversation(messages: AssistantMessage[]): string {
  return messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
}

/**
 * POST /ai/assistant — the one endpoint with no department gate at all
 * (just requireAuth + withTenantDb), per "the assistant must work for ANY
 * user in ANY department". Uses the tenant's own configured provider/key
 * when set (see tenant.controller.ts's updateAiConfigHandler), falling
 * back to the platform's global env config exactly like every other AI
 * pipeline — including the honest stub response when neither has a key.
 */
export const assistantHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { messages, context } = req.body as { messages: AssistantMessage[]; context?: { module: string; recordId?: number } };

  const [tenant] = await req.db!.select().from(tenants).where(eq(tenants.id, tenantId));
  const aiConfig = tenant?.aiConfig ?? {};

  const contextSummary = context ? await loadContextSummary(req.db!, tenantId, context.module, context.recordId) : null;
  const system = [SAFETY_PREAMBLE, contextSummary].filter(Boolean).join("\n\n");

  const result = await callLlmDetailed(flattenConversation(messages), {
    system,
    provider: aiConfig.provider,
    apiKey: aiConfig.apiKeyEncrypted ? decryptSecret(aiConfig.apiKeyEncrypted) : undefined,
    model: aiConfig.modelName,
    temperature: aiConfig.temperature,
    maxTokens: aiConfig.maxTokens,
  });

  // No dedicated chat-message table exists (no persistence, per this
  // module's scope) — entityId is the tenant, same convention the AI
  // config change entries already use, since there's no other real owning
  // record for "one assistant usage event" to key on. performedBy is the
  // real invoking user either way.
  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "AiAssistantMessage",
    entityId: tenantId,
    action: "create",
    changes: {
      usedModel: result.model,
      module: context?.module ?? null,
      tokens: result.usage ? result.usage.inputTokens + result.usage.outputTokens : null,
      aiUsed: true, // trivially always true for this endpoint — kept explicit since it's what module assistance buttons filter/report on
    },
    performedBy: req.user?.id,
  });

  res.json({ content: result.text, model: result.model, usage: result.usage });
});
