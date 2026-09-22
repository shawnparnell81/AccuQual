import { eq, and, desc } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { TenantDb } from "../../lib/tenantScope.js";
import { users } from "../../drizzle/schema/users.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import type { Department } from "../../middleware/departmentAccess.js";
import { metrics } from "../monitoring/metrics.js";

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

  /**
   * Phase 1 email infrastructure ("queue/retry logic"): retries a transient
   * failure (the provider's SMTP endpoint blipping, a momentary DNS/network
   * hiccup) up to 2 more times with backoff before giving up — same
   * attempt/backoff shape llm-gateway.ts's callLlmDetailed already uses for
   * its own transient-failure case (a 429 there; any thrown error here,
   * since nodemailer doesn't expose a structured "retryable" flag the way
   * an HTTP status code does). A message that's still failing after 3 real
   * attempts is recorded as "failed" in notification_log (see notify()
   * below) rather than silently retried forever — there's no background
   * worker in this app to keep retrying it later (see erpSyncSettings'
   * schema comment on the same honest limitation for scheduled ERP sync);
   * retryFailedNotifications() below is the explicit, triggered equivalent.
   */
  async send(message: { to: string; subject: string; body: string }): Promise<"sent" | "failed"> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transporter.sendMail({ from: env.SMTP_FROM, to: message.to, subject: message.subject, text: message.body });
        return "sent";
      } catch (err) {
        if (attempt === maxAttempts) {
          logger.error("SMTP send failed", { to: message.to, subject: message.subject, attempt, err });
          return "failed";
        }
        logger.warn("SMTP send failed, retrying", { to: message.to, attempt });
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    return "failed";
  }
}

// Fixed, non-secret endpoint (deliberately not configurable — an env-overridable
// URL would let a bad config point the Send Mail token at an arbitrary host).
const ZEPTOMAIL_API_URL = "https://api.zeptomail.com/v1.1/email";
const ZEPTOMAIL_TIMEOUT_MS = 15_000;

/** Splits "Name <addr@domain>" (or a bare address) into ZeptoMail's {address, name} shape. */
export function parseFromAddress(from: string): { address: string; name?: string } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+)>\s*$/);
  if (match) return { address: match[2]!, name: match[1]?.trim() || undefined };
  return { address: from.trim() };
}

/**
 * Delivery through ZeptoMail's REST API (agent `qms_transactional`,
 * verified domain accuqualqms.com) — the preferred path over SMTP: one HTTPS
 * call, a structured error body when the sender domain/token is wrong, and
 * no SMTP port to get blocked. The token comes from env only. ZeptoMail's
 * dashboard displays it as "Zoho-enczapikey <token>", so a pasted value
 * with or without that prefix works.
 *
 * Same retry shape as SmtpTransport, except only transient failures are
 * retried (network error, 429, 5xx) — a 4xx such as an unverified sender
 * domain or a bad token will fail identically every time, so it's reported
 * immediately with ZeptoMail's own error message instead of burning retries.
 */
export class ZeptoMailTransport implements EmailTransport {
  private authorization: string;
  private from: { address: string; name?: string };

  constructor(config: { token: string; from: string }) {
    this.authorization = `Zoho-enczapikey ${config.token.replace(/^\s*Zoho-enczapikey\s+/i, "").trim()}`;
    this.from = parseFromAddress(config.from);
  }

  async send(message: { to: string; subject: string; body: string }): Promise<"sent" | "failed"> {
    const maxAttempts = 3;
    const payload = JSON.stringify({
      from: this.from,
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      textbody: message.body,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryable = true;
      let reason: unknown;
      try {
        const response = await fetch(ZEPTOMAIL_API_URL, {
          method: "POST",
          headers: { Authorization: this.authorization, "Content-Type": "application/json", Accept: "application/json" },
          body: payload,
          signal: AbortSignal.timeout(ZEPTOMAIL_TIMEOUT_MS),
        });
        if (response.ok) return "sent";
        retryable = response.status === 429 || response.status >= 500;
        reason = { status: response.status, detail: (await response.text().catch(() => "")).slice(0, 300) };
      } catch (err) {
        reason = err;
      }

      if (!retryable || attempt === maxAttempts) {
        logger.error("ZeptoMail send failed", { to: message.to, subject: message.subject, attempt, reason });
        return "failed";
      }
      logger.warn("ZeptoMail send failed, retrying", { to: message.to, attempt });
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
    return "failed";
  }
}

/**
 * Real delivery is opt-in, exactly like every other real-external-call
 * feature in this app (BYOK AI, Digital Twin ingestion). Precedence:
 * ZEPTOMAIL_SEND_TOKEN (REST API) → all four SMTP_* vars (SmtpTransport) →
 * null (log-only, no network attempt).
 */
function resolveDefaultTransport(): EmailTransport | null {
  if (env.ZEPTOMAIL_SEND_TOKEN) {
    return new ZeptoMailTransport({ token: env.ZEPTOMAIL_SEND_TOKEN, from: env.SMTP_FROM });
  }
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
/** One delivery attempt through the active transport; a failure is counted for the "outgoing email" alert. */
async function deliver(transport: EmailTransport, message: { to: string; subject: string; body: string }): Promise<"sent" | "failed"> {
  const status = await transport.send(message).catch(() => "failed" as const);
  if (status === "failed") metrics.emailFailures.add();
  return status;
}

export async function sendEmail(message: { to: string; subject: string; body: string }): Promise<"sent" | "logged_only" | "failed"> {
  if (!activeTransport) {
    logger.info("Email (logged, not delivered — no transport configured)", message);
    return "logged_only";
  }
  return deliver(activeTransport, message);
}

/** Writes one notification_log row per recipient and returns how many were notified. */
export async function notifyRecipients(db: TenantDb, tenantId: number, recipients: string[], subject: string, body: string, relatedEntityType?: string, relatedEntityId?: number): Promise<number> {
  return notify(db, tenantId, recipients, subject, body, relatedEntityType, relatedEntityId);
}

async function notify(db: TenantDb, tenantId: number, recipients: string[], subject: string, body: string, relatedEntityType?: string, relatedEntityId?: number): Promise<number> {
  for (const recipient of recipients) {
    const status = activeTransport ? await deliver(activeTransport, { to: recipient, subject, body }) : "logged_only";
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

/**
 * Phase 1 email infrastructure ("queue/retry logic"), the explicit half:
 * SmtpTransport.send() already retries a transient failure 2 extra times
 * inline; this is for a message that was still "failed" after all of that
 * — most likely SMTP_* was unset (or wrong) at the time, not a one-off
 * blip. There's no background worker in this app to keep retrying it
 * automatically (same honest limitation as ERP Sync's own "no scheduler,
 * only an explicit trigger" — see erpSyncSettings' schema comment); this is
 * that same shape for email: an admin (or a future scheduled job, if one's
 * ever added) calls this to re-attempt every row still marked "failed" for
 * this tenant. Updates each row's own status in place rather than inserting
 * a new log row, so notification_log stays one row per real send attempt's
 * current outcome, not a growing chain of retries for the same message.
 */
export async function retryFailedNotifications(db: TenantDb, tenantId: number): Promise<{ retried: number; sent: number }> {
  const failed = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.status, "failed")));
  if (failed.length === 0 || !activeTransport) return { retried: 0, sent: 0 };

  let sent = 0;
  for (const entry of failed) {
    const status = await deliver(activeTransport, { to: entry.recipient, subject: entry.subject, body: entry.body });
    await db.update(notificationLog).set({ status }).where(eq(notificationLog.id, entry.id));
    if (status === "sent") sent++;
  }
  return { retried: failed.length, sent };
}

/** The caller's own email — req.user carries no email claim (see AuthenticatedUser), only id/tenantId/role/department, so every self-service notification query resolves it fresh from `users` rather than trusting anything client-supplied. */
async function ownEmail(db: TenantDb, tenantId: number, userId: number): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return row?.email ?? null;
}

/**
 * In-app notification bell — the first thing that ever reads notification_log back for display, so every query here
 * is hard-scoped to `recipient = the caller's own email` (never a client-supplied recipient, never another user's rows
 * even within the same tenant) on top of the usual tenant scoping. Newest first, capped, with an unread count computed
 * from the same rows rather than a second query.
 */
export async function listMyNotifications(db: TenantDb, tenantId: number, userId: number, limit = 30) {
  const email = await ownEmail(db, tenantId, userId);
  if (!email) return { rows: [], unreadCount: 0 };
  const rows = await db
    .select()
    .from(notificationLog)
    .where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.recipient, email)))
    .orderBy(desc(notificationLog.createdAt))
    .limit(limit);
  const unreadCount = rows.filter((r) => r.readAt === null).length;
  return { rows, unreadCount };
}

/** Marks one notification read — ownership is `recipient = the caller's own email`, not just a matching id, so a guessed id can never mark someone else's notification read (or reveal whether it exists). */
export async function markNotificationRead(db: TenantDb, tenantId: number, id: number, userId: number): Promise<boolean> {
  const email = await ownEmail(db, tenantId, userId);
  if (!email) return false;
  const [updated] = await db
    .update(notificationLog)
    .set({ readAt: new Date() })
    .where(and(eq(notificationLog.id, id), eq(notificationLog.tenantId, tenantId), eq(notificationLog.recipient, email)))
    .returning({ id: notificationLog.id });
  return !!updated;
}
