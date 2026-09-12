import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export const baseHandlers = crudFactory(audits, { entityName: "Audit", idColumn: "id" });

/** A logged finding is a real nonconformance once it's rated past a mere observation. */
const NONCONFORMANCE_SEVERITIES = ["minor", "major", "critical"];

export const addItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, auditId), eq(audits.tenantId, req.tenantId!)));
  if (!audit) throw AppError.notFound("Audit");

  const [item] = await req.db!.insert(auditItems).values({ ...req.body, auditId, tenantId: req.tenantId! }).returning();
  if (!item) throw new Error("Insert did not return the created audit item");

  // Automation: a nonconformance found during an internal audit opens its
  // own Discrepancy & Inspection investigation immediately, source-linked
  // back to the audit and this specific finding — no one has to remember to
  // start it by hand.
  let discrepancy = null;
  if (audit.type === "internal" && item.severity && NONCONFORMANCE_SEVERITIES.includes(item.severity)) {
    [discrepancy] = await req
      .db!.insert(discrepancyInvestigations)
      .values({
        tenantId: req.tenantId!,
        title: `Nonconformance — ${audit.name}: ${item.question ?? `Finding #${item.id}`}`,
        description: item.finding ?? undefined,
        severity: item.severity,
        status: "open",
        autoCreated: true,
        sourceAuditId: audit.id,
        sourceAuditItemId: item.id,
      })
      .returning();
    if (!discrepancy) throw new Error("Insert did not return the created discrepancy investigation");
    await recordAuditTrail(req.db!, {
      tenantId: req.tenantId!,
      entityType: "discrepancy_investigation",
      entityId: discrepancy.id,
      action: "create",
      changes: { autoCreated: true, sourceAuditId: audit.id, sourceAuditItemId: item.id, severity: item.severity },
      performedBy: req.user?.id,
    });
  }

  res.status(201).json({ ...item, discrepancyInvestigation: discrepancy });
});

export const listItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req
    .db!.select()
    .from(auditItems)
    .where(and(eq(auditItems.auditId, Number(req.params.id)), eq(auditItems.tenantId, req.tenantId!)));
  res.json(items);
});

export const completeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [updated] = await req
    .db!.update(audits)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(audits.id, id), eq(audits.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("Audit");
  res.json(updated);
});
