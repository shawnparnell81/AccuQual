import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { permissionRoles, userPermissionRoles } from "../../drizzle/schema/permissions.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import { fuelPumpFaiRecords } from "../../drizzle/schema/fuelPumpFai.js";
import { FPM_NUMBER_PREFIX, normalizeAssigneeKey, type FpmState } from "./fuelPumpFai.logic.js";

/** In-app bell only. Nothing is handed to the email transport. */
export async function notifyInApp(db: Db, emails: string[], subject: string, body: string, entityId: number | null): Promise<number> {
  const recipients = [...new Set(emails.map((email) => email.trim()).filter(Boolean))];
  if (recipients.length === 0) return 0;
  await db.insert(notificationLog).values(
    recipients.map((recipient) => ({
      channel: "in_app",
      recipient,
      subject,
      body,
      status: "logged_only",
      relatedEntityType: "FuelPumpFai",
      relatedEntityId: entityId ?? undefined,
    })),
  );
  return recipients.length;
}

export async function emailsForDepartment(db: Db, department: string): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(and(eq(users.department, department), eq(users.isActive, true)));
  return rows.map((row) => row.email);
}

export async function emailsForAssigneeLabel(db: Db, label: string): Promise<string[]> {
  const wanted = normalizeAssigneeKey(label);
  const system = await db
    .select({ email: users.email, roleName: roles.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.isActive, true));
  const custom = await db
    .select({ email: users.email, roleName: permissionRoles.roleName })
    .from(users)
    .innerJoin(userPermissionRoles, eq(userPermissionRoles.userId, users.id))
    .innerJoin(permissionRoles, eq(permissionRoles.id, userPermissionRoles.roleId))
    .where(eq(users.isActive, true));
  const emails = [...system, ...custom].filter((row) => normalizeAssigneeKey(row.roleName) === wanted).map((row) => row.email);
  return [...new Set(emails)];
}

export async function emailForUser(db: Db, userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const [row] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.isActive, true)));
  return row?.email ?? null;
}

export async function persistFpm(db: Db, state: FpmState): Promise<void> {
  if (state.fuelPumpFaiId == null) return;
  await db
    .update(fuelPumpFaiRecords)
    .set({
      partNumber: state.partNumber,
      partDescription: state.partDescription,
      supplier: state.supplier,
      supplierPartNumber: state.supplierPartNumber,
      sampleLotNumber: state.sampleLotNumber,
      vehicleYear: state.vehicleYear,
      vehicleMake: state.vehicleMake,
      vehicleModel: state.vehicleModel,
      vehicleEngine: state.vehicleEngine,
      application: state.application,
      inspector: state.inspector,
      inspectorUserId: state.inspectorUserId,
      validationOwner: state.validationOwner,
      qualityManager: state.qualityManager,
      status: state.status,
      workflowStage: state.stage,
      overallResult: state.overallResult,
      flowRateResult: state.flowRateResult,
      pressureResult: state.pressureResult,
      currentDrawResult: state.currentDrawResult,
      electricalResult: state.electricalResult,
      fitmentResult: state.fitmentResult,
      packagingResult: state.packagingResult,
      failureDetected: state.failureDetected,
      ncrRequired: state.ncrRequired,
      linkedNcr: state.ncrId,
      productionRelease: state.productionRelease,
      attemptNumber: state.attempt.number,
      locked: state.locked,
      slaStatus: state.slaStatus,
      rejectionReason: state.rejectionReason,
      rejectedBy: state.rejectedBy,
      rejectionDate: state.rejectionDate ? new Date(state.rejectionDate) : null,
      approvalDate: state.approvalDate ? new Date(state.approvalDate) : null,
      approvedBy: state.approvedBy,
      dateClosed: state.dateClosed ? new Date(state.dateClosed) : null,
      siteId: state.siteId,
      packet: { ...state },
      updatedAt: new Date(),
    })
    .where(eq(fuelPumpFaiRecords.id, state.fuelPumpFaiId));
}

export async function nextFuelPumpNumber(db: Db, year: number): Promise<string> {
  const found = await db.execute(sql`
    INSERT INTO fuel_pump_fai_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = fuel_pump_fai_counters.last_value + 1
    RETURNING last_value
  `);
  const sequence = Number((found.rows?.[0] as { last_value?: number } | undefined)?.last_value ?? 1);
  return `${FPM_NUMBER_PREFIX}-${year}-${String(sequence).padStart(6, "0")}`;
}
