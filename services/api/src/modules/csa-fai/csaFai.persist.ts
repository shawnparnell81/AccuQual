import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { permissionRoles, userPermissionRoles } from "../../drizzle/schema/permissions.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import { csaFaiRecords } from "../../drizzle/schema/csaFai.js";
import { normalizeAssigneeKey, type CsaState } from "./csaFai.logic.js";

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
      relatedEntityType: "CsaFai",
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

export function packetFrom(state: CsaState): Record<string, unknown> {
  return { ...state };
}

export async function persistCsa(db: Db, state: CsaState): Promise<void> {
  if (state.csaFaiId == null) return;
  await db
    .update(csaFaiRecords)
    .set({
      partNumber: state.partNumber,
      partDescription: state.partDescription,
      supplierName: state.supplierName,
      supplierPartNumber: state.supplierPartNumber,
      sampleLotNumber: state.sampleLotNumber,
      vehicleYear: state.vehicleYear,
      vehicleMake: state.vehicleMake,
      vehicleModel: state.vehicleModel,
      position: state.position,
      inspectorName: state.inspectorName,
      inspectorUserId: state.inspectorUserId,
      status: state.status,
      stage: state.stage,
      productFamily: state.productFamily,
      productionRelease: state.productionRelease,
      approvedSupplier: state.approvedSupplier,
      ncrRequired: state.ncrRequired,
      failureDetected: state.failureDetected,
      ncrId: state.ncrId,
      attemptNumber: state.attempt.number,
      locked: state.locked,
      slaStatus: state.slaStatus,
      rejectionReason: state.rejectionReason,
      rejectedBy: state.rejectedBy,
      rejectionDate: state.rejectionDate ? new Date(state.rejectionDate) : null,
      approvalDate: state.approvalDate ? new Date(state.approvalDate) : null,
      approvedBy: state.approvedBy,
      dateClosed: state.dateClosed ? new Date(state.dateClosed) : null,
      packet: packetFrom(state),
      updatedAt: new Date(),
    })
    .where(eq(csaFaiRecords.id, state.csaFaiId));
}

export async function nextCsaNumber(db: Db, year: number): Promise<string> {
  const found = await db.execute(sql`
    INSERT INTO csa_fai_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = csa_fai_counters.last_value + 1
    RETURNING last_value
  `);
  const sequence = Number((found.rows?.[0] as { last_value?: number } | undefined)?.last_value ?? 1);
  return `CSA-FAI-${year}-${String(sequence).padStart(6, "0")}`;
}
