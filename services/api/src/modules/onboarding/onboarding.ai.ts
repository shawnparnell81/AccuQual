import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { PERMISSION_MATRIX, type ResourceKey, type Department } from "../../middleware/departmentAccess.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { callLlm } from "../ai/llm-gateway.js";
import { onboardingPrompt } from "../ai/prompts.js";
import { checkUsageLimit, loadTenantLlmOptions } from "../ai/ai.usage.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

/**
 * Real, honest descriptions of what each module actually does today — no
 * "enabled modules per tenant" concept exists anywhere in this schema (see
 * the AI Onboarding review), so this is grounded on the one real signal
 * available: PERMISSION_MATRIX, walked for the requesting user's own
 * department to find which ResourceKeys they can actually reach.
 */
const MODULE_DESCRIPTIONS: Partial<Record<ResourceKey, { label: string; description: string }>> = {
  ncr: { label: "NCR", description: "Log and track nonconforming material/product through containment, investigation, and closure." },
  capa: { label: "CAPA", description: "Corrective and Preventive Action plans, usually opened from an NCR's root cause." },
  eight_d: { label: "8D", description: "Structured 8-discipline problem-solving reports for customer-facing issues." },
  di: { label: "Discrepancy Investigation", description: "Investigate a discrepancy before it's formally an NCR." },
  audit: { label: "Audits", description: "Schedule and run internal/supplier/customer audits, log findings and severities." },
  calibration: { label: "Calibration", description: "Track equipment and their calibration due dates/history." },
  pareto: { label: "Pareto", description: "Read-only Pareto charts over recorded quality data." },
  suppliers: { label: "Suppliers", description: "Supplier records, scorecards, and status (active/probation/disqualified)." },
  complaints: { label: "Complaints", description: "Customer complaint intake and resolution tracking." },
  ppap: { label: "PPAP", description: "Production Part Approval Process packages." },
  apqp: { label: "APQP", description: "Advanced Product Quality Planning records." },
  production_log: { label: "Production Log", description: "Daily/shift production log forms." },
  inventory: { label: "Inventory", description: "Stock levels, movements, min/max thresholds, and reorder alerts." },
  erp: { label: "Purchase Orders", description: "Purchase orders and receiving against your suppliers." },
  rma: { label: "RMA/RGA", description: "Return Merchandise/Goods Authorizations sent to suppliers." },
  work_orders: { label: "Work Orders", description: "Production work orders — plan, start, and complete production runs." },
  purchase_requisitions: { label: "Purchase Requisitions", description: "Request a purchase; purchasing approves and converts it to a real PO." },
};

/**
 * POST /onboarding/ai-generate — no department gate (like /ai/assistant):
 * every user, regardless of department, can ask for their own onboarding
 * checklist. Read-only — never touches any QMS data, only its own
 * ai_suggestions audit row. The frontend renders the checklist and lets
 * the user mark items via PATCH /onboarding/progress/:moduleKey.
 */
export const onboardingAiGenerateHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const department = req.user?.department as Department | null | undefined;
  const role = req.user?.roleName;
  const isAdmin = role === "admin" || role === "platform_admin";

  const accessibleModules = (Object.keys(PERMISSION_MATRIX) as ResourceKey[])
    .filter((key) => isAdmin || (department && PERMISSION_MATRIX[key][department] && PERMISSION_MATRIX[key][department] !== "none"))
    .map((key) => ({ moduleKey: key, ...(MODULE_DESCRIPTIONS[key] ?? { label: key, description: "" }) }));

  if (accessibleModules.length === 0) {
    throw AppError.badRequest("No department is set on your account yet — an admin needs to assign one before onboarding can suggest anything.");
  }

  const { tenant, llmOptions } = await loadTenantLlmOptions(req.db!, tenantId);
  const limitError = await checkUsageLimit(req.db!, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const inputData = { department: department ?? (isAdmin ? "admin" : null), accessibleModules };
  const raw = await callLlm(onboardingPrompt(inputData), { system: "You are AccuQual's onboarding assistant.", ...llmOptions });

  let output: unknown;
  try {
    output = JSON.parse(raw);
  } catch {
    output = { raw };
  }

  const [saved] = await req
    .db!.insert(aiSuggestions)
    .values({ tenantId, module: "onboarding", pipeline: "onboarding", input: inputData, output: output as Record<string, unknown>, createdBy: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "AiSuggestion",
    entityId: saved!.id,
    action: "create",
    changes: { module: "onboarding", pipeline: "onboarding" },
    performedBy: req.user?.id,
  });

  res.json(saved);
});
