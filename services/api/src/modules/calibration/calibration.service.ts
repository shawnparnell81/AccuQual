import { and, eq, inArray, gte, like } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { db as ownerDb } from "../../db/index.js";
import { equipment, calibrations, type Calibration, type Equipment, type EquipmentStatus } from "../../drizzle/schema/calibration.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyDepartment } from "../notifications/notification.service.js";

/**
 * Equipment & calibration rules, in one place. A calibration is SCHEDULED (a planned date, nothing performed), then either
 * COMPLETED (pass / adjusted: sets the next due date) or FAILED (fail: sets none). A failed calibration takes the equipment
 * OUT OF SERVICE; a later passing calibration puts it back. Anything else that pulls equipment out of service, or overrides a
 * failed calibration, needs a written reason (and, for the override, a reviewer). Other modules are told what happened through
 * events (module "calibration"), not through shared tables.
 */

export type DueStatus = "failed" | "overdue" | "due_soon" | "upcoming" | "current" | "uncalibrated";

const DAY_MS = 86_400_000;

/** Where a piece of equipment stands against its due date. Thresholds follow the long-standing 60 / 30 day colour bands. */
export function dueStatusOf(nextDueAt: Date | null, latestFailed: boolean, now: Date = new Date()): DueStatus {
  if (latestFailed) return "failed";
  if (!nextDueAt) return "uncalibrated";
  const days = Math.ceil((nextDueAt.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  if (days <= 60) return "upcoming";
  return "current";
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

export interface EquipmentSummary {
  lastCalibratedAt: Date | null;
  lastResult: string | null;
  nextDueAt: Date | null;
  dueStatus: DueStatus;
  /** The open scheduled calibration, if any. */
  scheduledCalibrationId: number | null;
  nextScheduledAt: Date | null;
  scheduleOverdue: boolean;
}

/** Latest finished calibration and the open schedule for each piece of equipment. */
export function summarize(items: Equipment[], cals: Calibration[], now: Date = new Date()): Map<number, EquipmentSummary> {
  const out = new Map<number, EquipmentSummary>();
  for (const item of items) {
    const mine = cals.filter((c) => c.equipmentId === item.id);
    const done = mine.filter((c) => c.status !== "scheduled" && c.performedAt).sort((a, b) => b.performedAt!.getTime() - a.performedAt!.getTime() || b.id - a.id);
    const latest = done[0] ?? null;
    const open = mine.filter((c) => c.status === "scheduled" && c.scheduledAt).sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0] ?? null;
    out.set(item.id, {
      lastCalibratedAt: latest?.performedAt ?? null,
      lastResult: latest?.result ?? null,
      nextDueAt: latest && latest.status === "completed" ? latest.nextDueAt : null,
      dueStatus: dueStatusOf(latest && latest.status === "completed" ? latest.nextDueAt : null, latest?.status === "failed", now),
      scheduledCalibrationId: open?.id ?? null,
      nextScheduledAt: open?.scheduledAt ?? null,
      scheduleOverdue: !!open?.scheduledAt && open.scheduledAt.getTime() < now.getTime(),
    });
  }
  return out;
}

async function loadEquipment(db: TenantDb, id: number): Promise<Equipment> {
  const [item] = await db.select().from(equipment).where(and(eq(equipment.id, id)));
  if (!item) throw AppError.notFound("Equipment");
  return item;
}

async function emit(event: string, equipmentId: number, extra: Record<string, unknown> = {}) {
  await publishEvent(WORKFLOW_STREAM, { module: "calibration", event, entityId: equipmentId, ...extra });
}

export async function listEquipmentWithSummary(db: TenantDb) {
  const items = await db.select().from(equipment);
  const cals = await db.select().from(calibrations);
  const summaries = summarize(items, cals);
  return items.map((item) => ({ ...item, ...summaries.get(item.id)! }));
}

export async function getEquipmentWithSummary(db: TenantDb, id: number) {
  const item = await loadEquipment(db, id);
  const cals = await db.select().from(calibrations).where(and(eq(calibrations.equipmentId, id)));
  return { ...item, ...summarize([item], cals).get(id)! };
}

// ---- Status ----------------------------------------------------------------------------------------------------------------------------------------

export interface StatusChangeOptions {
  reason?: string;
  cause?: "calibration_failure" | "manual";
  /** Set by the caller when the user holds the override permission (admin / quality manager). */
  canOverride: boolean;
}

const MIN_REASON = 5;

/**
 * Moves equipment between active / inactive / out_of_service.
 *  - Taking it out of service, or returning it from out of service, needs a reason.
 *  - Returning equipment that a FAILED calibration took out of service (without a passing calibration since) is an override:
 *    it needs the override permission, and is recorded as one.
 */
export async function changeEquipmentStatus(db: TenantDb, id: number, target: EquipmentStatus, opts: StatusChangeOptions, actor?: number): Promise<Equipment> {
  const item = await loadEquipment(db, id);
  if (item.status === target) throw AppError.badRequest(`This equipment is already ${target.replace("_", " ")}.`);
  const reason = opts.reason?.trim() ?? "";
  const leavingOutOfService = item.status === "out_of_service";
  if ((target === "out_of_service" || leavingOutOfService) && reason.length < MIN_REASON) {
    throw AppError.badRequest(`Say why (at least ${MIN_REASON} characters) — a change to or from "out of service" is recorded with its reason.`);
  }

  const failureHold = leavingOutOfService && item.statusCause === "calibration_failure" && target === "active";
  if (failureHold && !opts.canOverride) {
    throw AppError.forbidden("A failed calibration took this equipment out of service. It returns to service when a calibration passes; only an admin or quality manager can override that.");
  }
  if (target === "active") await assertNoUnresolvedFailure(db, id, opts.canOverride);

  const [updated] = await db
    .update(equipment)
    .set({
      status: target,
      statusReason: target === "active" ? null : reason || null,
      statusCause: target === "out_of_service" ? (opts.cause ?? "manual") : null,
      statusChangedAt: new Date(),
      statusChangedBy: actor ?? null,
    })
    .where(and(eq(equipment.id, id)))
    .returning();
  await recordAuditTrail(db, {
    entityType: "Equipment",
    entityId: id,
    action: "status_change",
    changes: { event: failureHold ? "failure_override" : "equipment_status_changed", from: item.status, to: target, reason: reason || null, cause: opts.cause ?? (target === "out_of_service" ? "manual" : null) },
    performedBy: actor,
  });
  await emit(target === "out_of_service" ? "out_of_service" : target === "active" ? "returned_to_service" : "inactivated", id, { reason: reason || undefined });
  return updated!;
}

/** Equipment whose latest calibration FAILED can't simply be set active by anyone. */
async function assertNoUnresolvedFailure(db: TenantDb, id: number, canOverride: boolean) {
  if (canOverride) return;
  const cals = await db.select().from(calibrations).where(and(eq(calibrations.equipmentId, id)));
  const done = cals.filter((c) => c.status !== "scheduled" && c.performedAt).sort((a, b) => b.performedAt!.getTime() - a.performedAt!.getTime() || b.id - a.id);
  if (done[0]?.status === "failed") throw AppError.forbidden("The latest calibration of this equipment failed. It needs a passing calibration, or an override by an admin or quality manager.");
}

// ---- Scheduling and completing ---------------------------------------------------------------------------------------------------------

export async function scheduleCalibration(db: TenantDb, equipmentId: number, input: { scheduledAt: Date; notes?: string }, actor?: number): Promise<Calibration> {
  const item = await loadEquipment(db, equipmentId);
  if (item.status === "inactive") throw AppError.badRequest("This equipment is inactive. Make it active before scheduling a calibration.");
  const [open] = await db.select().from(calibrations).where(and(eq(calibrations.equipmentId, equipmentId), eq(calibrations.status, "scheduled")));
  if (open) throw new AppError(`A calibration is already scheduled for ${open.scheduledAt?.toISOString().slice(0, 10) ?? "this equipment"}. Complete or cancel it first.`, 409);

  const [created] = await db.insert(calibrations).values({ equipmentId, status: "scheduled", scheduledAt: input.scheduledAt, scheduledBy: actor ?? null, notes: input.notes }).returning();
  await recordAuditTrail(db, { entityType: "Equipment", entityId: equipmentId, action: "create", changes: { event: "calibration_scheduled", calibrationId: created!.id, scheduledAt: input.scheduledAt }, performedBy: actor });
  await emit("scheduled", equipmentId, { calibrationId: created!.id });
  return created!;
}

export async function cancelScheduledCalibration(db: TenantDb, calibrationId: number, actor?: number): Promise<void> {
  const [cal] = await db.select().from(calibrations).where(and(eq(calibrations.id, calibrationId)));
  if (!cal) throw AppError.notFound("Calibration");
  if (cal.status !== "scheduled") throw new AppError("Only a scheduled calibration can be cancelled — a completed one is part of the record.", 409);
  await db.delete(calibrations).where(and(eq(calibrations.id, calibrationId)));
  await recordAuditTrail(db, { entityType: "Equipment", entityId: cal.equipmentId, action: "delete", changes: { event: "calibration_schedule_cancelled", calibrationId, scheduledAt: cal.scheduledAt }, performedBy: actor });
}

export interface CompletionInput {
  performedAt: Date;
  result?: "pass" | "fail" | "adjusted" | string | null;
  results?: Record<string, unknown> | null;
  technicianName?: string;
  notes?: string;
}

/** What follows any finished calibration: the due date, the failure hold or return to service, the audit entry, the event, the notice. */
async function applyOutcome(db: TenantDb, item: Equipment, cal: Calibration, actor?: number) {
  const failed = cal.status === "failed";
  await recordAuditTrail(db, {
    entityType: "Equipment",
    entityId: item.id,
    action: "status_change",
    changes: { event: failed ? "calibration_failed" : "calibration_completed", calibrationId: cal.id, result: cal.result, technicianName: cal.technicianName, nextDueAt: cal.nextDueAt },
    performedBy: actor,
  });
  await emit(failed ? "failed" : "completed", item.id, { calibrationId: cal.id, result: cal.result ?? undefined });

  if (failed) {
    if (item.status !== "out_of_service") {
      await db.update(equipment).set({ status: "out_of_service", statusReason: `Failed calibration #${cal.id}`, statusCause: "calibration_failure", statusChangedAt: new Date(), statusChangedBy: actor ?? null }).where(and(eq(equipment.id, item.id)));
      await recordAuditTrail(db, { entityType: "Equipment", entityId: item.id, action: "status_change", changes: { event: "equipment_status_changed", from: item.status, to: "out_of_service", reason: `Failed calibration #${cal.id}`, cause: "calibration_failure" }, performedBy: actor });
      await emit("out_of_service", item.id, { reason: "calibration_failure", calibrationId: cal.id });
    }
    await notifyDepartment(db, { department: "quality", subject: `Calibration failed: ${item.name}`, body: `${item.name}${item.serialNumber ? ` (${item.serialNumber})` : ""} failed calibration and has been taken out of service. Product measured with it since its last good calibration may need review.`, relatedEntityType: "Equipment", relatedEntityId: item.id }).catch((err) => logger.error("Calibration failure notice failed", { err: String(err) }));
  } else if (item.status === "out_of_service" && item.statusCause === "calibration_failure") {
    await db.update(equipment).set({ status: "active", statusReason: null, statusCause: null, statusChangedAt: new Date(), statusChangedBy: actor ?? null }).where(and(eq(equipment.id, item.id)));
    await recordAuditTrail(db, { entityType: "Equipment", entityId: item.id, action: "status_change", changes: { event: "returned_to_service", from: "out_of_service", to: "active", reason: `Passed calibration #${cal.id}`, cause: "calibration_pass" }, performedBy: actor });
    await emit("returned_to_service", item.id, { calibrationId: cal.id });
  }
}

function outcomeFields(item: Equipment, input: CompletionInput) {
  const failed = input.result === "fail";
  return {
    status: (failed ? "failed" : "completed") as "failed" | "completed",
    performedAt: input.performedAt,
    completedAt: new Date(),
    result: input.result ?? null,
    results: input.results ?? null,
    technicianName: input.technicianName,
    notes: input.notes,
    // A failed calibration establishes no new due date: the equipment has to be calibrated again.
    nextDueAt: failed ? null : addDays(input.performedAt, item.calibrationIntervalDays),
  };
}

/** Completes a scheduled calibration. */
export async function completeCalibration(db: TenantDb, calibrationId: number, input: CompletionInput, actor?: number): Promise<Calibration> {
  const [cal] = await db.select().from(calibrations).where(and(eq(calibrations.id, calibrationId)));
  if (!cal) throw AppError.notFound("Calibration");
  if (cal.status !== "scheduled") throw new AppError("This calibration is already finished.", 409);
  const item = await loadEquipment(db, cal.equipmentId);
  const [updated] = await db.update(calibrations).set({ ...outcomeFields(item, input), performedBy: actor ?? null }).where(and(eq(calibrations.id, calibrationId))).returning();
  await applyOutcome(db, item, updated!, actor);
  return updated!;
}

/**
 * Records a calibration that has been done (the "Calibration Record" form's Log button, and POST /equipment/:id/calibration with a
 * performed date). If a calibration was scheduled for this equipment, that one is completed rather than a second row created, so a
 * schedule never lingers after the work is logged.
 */
export async function recordCompletedCalibration(db: TenantDb, equipmentId: number, input: CompletionInput, actor?: number): Promise<Calibration> {
  const item = await loadEquipment(db, equipmentId);
  const [open] = await db.select().from(calibrations).where(and(eq(calibrations.equipmentId, equipmentId), eq(calibrations.status, "scheduled")));
  if (open) return completeCalibration(db, open.id, input, actor);
  const [created] = await db.insert(calibrations).values({ equipmentId, scheduledAt: input.performedAt, ...outcomeFields(item, input), performedBy: actor ?? null }).returning();
  if (!created) throw new AppError("Failed to record calibration event", 500);
  await recordAuditTrail(db, { entityType: "Equipment", entityId: equipmentId, action: "create", changes: { calibrationId: created.id, technicianName: input.technicianName, result: input.result, nextDueAt: created.nextDueAt }, performedBy: actor });
  await applyOutcome(db, item, created, actor);
  return created;
}

// ---- What needs attention, and telling people ------------------------------------------------------------------------------------------------

export interface AttentionItem {
  id: number;
  name: string;
  serialNumber: string | null;
  location: string | null;
  status: EquipmentStatus;
  dueStatus: DueStatus;
  nextDueAt: Date | null;
  reason: "out_of_service" | "failed" | "overdue" | "due_soon" | "schedule_overdue";
}

/** Equipment a person should look at: out of service, failed, overdue, due within 30 days, or with a calibration that should have happened by now. */
export async function attention(db: TenantDb): Promise<AttentionItem[]> {
  const rows = await listEquipmentWithSummary(db);
  const out: AttentionItem[] = [];
  for (const r of rows) {
    if (r.status === "inactive") continue;
    const reason: AttentionItem["reason"] | null = r.status === "out_of_service" ? "out_of_service" : r.dueStatus === "failed" ? "failed" : r.dueStatus === "overdue" ? "overdue" : r.dueStatus === "due_soon" ? "due_soon" : r.scheduleOverdue ? "schedule_overdue" : null;
    if (reason) out.push({ id: r.id, name: r.name, serialNumber: r.serialNumber, location: r.location, status: r.status, dueStatus: r.dueStatus, nextDueAt: r.nextDueAt, reason });
  }
  const rank = { out_of_service: 0, failed: 1, overdue: 2, schedule_overdue: 3, due_soon: 4 } as const;
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || a.name.localeCompare(b.name));
}

const DIGEST_SUBJECT = "Calibration due";

/** One digest to the Quality department listing what is overdue / due soon / out of service. Returns how many items it covered. */
export async function notifyDue(db: TenantDb, opts: { dedupeHours?: number } = {}): Promise<{ items: number; notified: number; skipped: boolean }> {
  const items = await attention(db);
  if (items.length === 0) return { items: 0, notified: 0, skipped: false };
  if (opts.dedupeHours) {
    const since = new Date(Date.now() - opts.dedupeHours * 3_600_000);
    const [recent] = await db.select({ id: notificationLog.id }).from(notificationLog).where(and(like(notificationLog.subject, `${DIGEST_SUBJECT}%`), gte(notificationLog.createdAt, since))).limit(1);
    if (recent) return { items: items.length, notified: 0, skipped: true };
  }
  const label: Record<AttentionItem["reason"], string> = { out_of_service: "OUT OF SERVICE", failed: "FAILED calibration", overdue: "OVERDUE", schedule_overdue: "scheduled calibration not done", due_soon: "due within 30 days" };
  const lines = items.slice(0, 40).map((i) => `- ${i.name}${i.serialNumber ? ` (${i.serialNumber})` : ""}: ${label[i.reason]}${i.nextDueAt ? `, due ${i.nextDueAt.toISOString().slice(0, 10)}` : ""}`);
  const overdue = items.filter((i) => i.reason === "overdue" || i.reason === "failed" || i.reason === "out_of_service").length;
  const notified = await notifyDepartment(db, { department: "quality", subject: `${DIGEST_SUBJECT}: ${items.length} item${items.length === 1 ? "" : "s"} need attention${overdue ? ` (${overdue} overdue or out of service)` : ""}`, body: `${lines.join("\n")}${items.length > 40 ? `\n…and ${items.length - 40} more` : ""}`, relatedEntityType: "Equipment" });
  return { items: items.length, notified, skipped: false };
}

/** Runs notifyDue for every organization that has equipment (used by the daily timer). Never throws. */
export async function sweepDueCalibrations(): Promise<{ tenants: number; notified: number }> {
  let tenantsSwept = 0;
  let notified = 0;
  try {
    const ids = await ownerDb.selectDistinct({ }).from(equipment).where(inArray(equipment.status, ["active", "out_of_service"]));
    for (const { tenantId } of ids) {
      try {
        const r = await notifyDue(ownerDb as unknown as TenantDb, { dedupeHours: 20 });
        tenantsSwept += 1;
        notified += r.notified;
      } catch (err) {
        logger.error("Calibration due sweep failed for a tenant", { err: String(err) });
      }
    }
  } catch (err) {
    logger.error("Calibration due sweep failed", { err: String(err) });
  }
  return { tenants: tenantsSwept, notified };
}

let sweepHandle: ReturnType<typeof setInterval> | null = null;
/** Starts the once-every-six-hours sweep (each organization gets at most one digest per 20 hours). Idempotent. */
export function startCalibrationSweep(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void sweepDueCalibrations(), 2 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void sweepDueCalibrations(), 6 * 3_600_000);
  sweepHandle.unref?.();
}
export function stopCalibrationSweep(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}
