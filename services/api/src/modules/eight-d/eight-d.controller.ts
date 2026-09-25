import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { eightD } from "../../drizzle/schema/eightD.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(eightD, { entityName: "8D Report", idColumn: "id" });

/** D1-D8 step keys, in order. Completing D8 marks the report closed. */
const STEP_KEYS = [
  "d1_team",
  "d2_problem",
  "d3_containment",
  "d4_rootCause",
  "d5_correctiveAction",
  "d6_implementation",
  "d7_prevention",
  "d8_closure",
] as const;

/**
 * Phase 9 — previously the one live, genuinely working transition endpoint
 * in the whole app with ZERO audit trail / workflow event calls (confirmed
 * by the Phase 9 workflow-engine research), so a completed 8D step was
 * invisible to the record's own History tab and to any workflow definition
 * reacting to "8d" events. Additive only — the step-progression logic above
 * (no prior-step requirement, any step 1-8 in any order) is unchanged; this
 * only adds observability on top of it, same treatment as the Document
 * Revision fix right above.
 */
export const completeStepHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const step = Number(req.params.step);
  if (step < 1 || step > 8) throw AppError.badRequest("Step must be between 1 and 8");

  const [existing] = await req.db!.select().from(eightD).where(and(eq(eightD.id, id)));
  if (!existing) throw AppError.notFound("8D Report");

  const stepKey = STEP_KEYS[step - 1] ?? "d1_team";
  const mergedData = { ...(existing.data ?? {}), [stepKey]: req.body.data };
  const nextStep = Math.min(step + 1, 8);

  const [updated] = await req
    .db!.update(eightD)
    .set({ data: mergedData, currentStep: nextStep, updatedAt: new Date() })
    .where(and(eq(eightD.id, id)))
    .returning();

  const isClosure = step === 8;
  await recordAuditTrail(req.db!, {
    entityType: "8D Report",
    entityId: id,
    action: isClosure ? "status_change" : "update",
    changes: { subAction: "step_completed", step, stepKey, ...(isClosure ? { closed: true } : {}) },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "eight_d", event: isClosure ? "closed" : "step_completed", entityId: id });

  res.json(updated);
});
