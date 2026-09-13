import { eq, and } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { users } from "../../drizzle/schema/users.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { logger } from "../../utils/logger.js";
import type { Department } from "../../middleware/departmentAccess.js";

interface NotifyDepartmentInput {
  tenantId: number;
  department: Department;
  subject: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
}

/**
 * A transport is anything that can attempt delivery of one message and
 * report whether it actually sent. `LogTransport` is the only one that
 * exists today — AccuQual has no SMTP/provider configured anywhere (see
 * the Inventory module plan's "remaining gaps" section) — so every send
 * is honestly recorded as "logged_only" rather than claiming a delivery
 * that didn't happen. Swapping in a real transport (SMTP, SendGrid, SES,
 * ...) later means implementing this interface and changing one line in
 * notify()/notifyDepartment() — no caller changes.
 */
export interface EmailTransport {
  send(message: { to: string; subject: string; body: string }): Promise<"sent" | "failed">;
}

export const logTransport: EmailTransport = {
  async send(message) {
    logger.info("Email (logged, not delivered — no transport configured)", message);
    return "sent";
  },
};

let activeTransport: EmailTransport | null = null; // null = log-only, no network attempt at all

/** For tests, or for wiring in a real transport once one exists. */
export function setEmailTransport(transport: EmailTransport | null) {
  activeTransport = transport;
}

/** Writes one notification_log row per recipient and returns how many were notified. */
async function notify(db: TenantDb, tenantId: number, recipients: string[], subject: string, body: string, relatedEntityType?: string, relatedEntityId?: number): Promise<number> {
  for (const recipient of recipients) {
    const status = activeTransport ? await activeTransport.send({ to: recipient, subject, body }).catch(() => "failed" as const) : "logged_only";
    await db.insert(notificationLog).values({ tenantId, channel: "email", recipient, subject, body, status, relatedEntityType, relatedEntityId });
  }
  return recipients.length;
}

/**
 * Real recipients, not a fabricated "department email" setting — no such
 * thing exists in AccuQual (users.department is per-user, not per-
 * department). Every active user in the department gets one row.
 */
export async function notifyDepartment(db: TenantDb, input: NotifyDepartmentInput): Promise<number> {
  const recipients = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), eq(users.department, input.department), eq(users.isActive, true)));

  if (recipients.length === 0) return 0;

  return notify(
    db,
    input.tenantId,
    recipients.map((r) => r.email),
    input.subject,
    input.body,
    input.relatedEntityType,
    input.relatedEntityId
  );
}
