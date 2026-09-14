import { eq, and } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { TenantDb } from "../../lib/tenantScope.js";
import { users } from "../../drizzle/schema/users.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
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

/**
 * Real delivery (Inspection Report R06) — plain SMTP via nodemailer, which
 * works against any real provider (SendGrid, SES, Postmark, a real mailbox,
 * ...) that exposes an SMTP endpoint, without picking one specific vendor's
 * SDK. Only constructed when all four SMTP_* vars are actually set (see
 * resolveDefaultTransport below) — this class itself doesn't decide whether
 * to exist, so it never silently swaps in with partial/missing config.
 */
export class SmtpTransport implements EmailTransport {
  private transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(config: { host: string; port: number; user: string; password: string }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
  }

  async send(message: { to: string; subject: string; body: string }): Promise<"sent" | "failed"> {
    try {
      await this.transporter.sendMail({ from: env.SMTP_FROM, to: message.to, subject: message.subject, text: message.body });
      return "sent";
    } catch (err) {
      logger.error("SMTP send failed", { to: message.to, subject: message.subject, err });
      return "failed";
    }
  }
}

/** SMTP_HOST/PORT/USER/PASSWORD are all optional and default to unset — real delivery is opt-in, exactly like every other real-external-call feature in this app (BYOK AI, Digital Twin ingestion). */
function resolveDefaultTransport(): EmailTransport | null {
  if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD) {
    return new SmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD });
  }
  return null;
}

let activeTransport: EmailTransport | null = resolveDefaultTransport(); // null = log-only, no network attempt at all

/** For tests, or for overriding the env-resolved transport at runtime. */
export function setEmailTransport(transport: EmailTransport | null) {
  activeTransport = transport;
}

/**
 * One-off, single-recipient send (password reset, future account-level
 * emails) — notifyDepartment below is for "every active user in department
 * X," a different shape. Not tied to a tenant transaction: callers like
 * forgot-password run before any tenant context exists (see
 * auth.service.ts's own comment on why login/register use the unscoped db),
 * so this never touches notification_log the way notifyDepartment does —
 * there's no tenant-scoped table to write it against pre-auth. Real
 * delivery still goes through the exact same transport.
 */
export async function sendEmail(message: { to: string; subject: string; body: string }): Promise<"sent" | "logged_only" | "failed"> {
  if (!activeTransport) {
    logger.info("Email (logged, not delivered — no transport configured)", message);
    return "logged_only";
  }
  return activeTransport.send(message).catch(() => "failed" as const);
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
