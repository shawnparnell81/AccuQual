import { and, eq } from "drizzle-orm";
import { users } from "../drizzle/schema/users.js";
import type { TenantDb } from "../lib/tenantScope.js";
import { AppError } from "./appError.js";

/** An assignee must be an active user of the SAME tenant — a bare FK to users(id) alone would accept another tenant's user id. */
export async function assertTenantUser(db: TenantDb, tenantId: number, userId: number): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)));
  if (!row) throw AppError.badRequest("Assignee must be an active user in this organization.");
}
