import type { Db } from "../../lib/requestDb.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { sendEmail } from "../notifications/notification.service.js";
import { logger } from "../../utils/logger.js";

export type ReportEmailStatus = "sent" | "logged_only" | "failed";

export interface ReportDelivery {
  to: string;
  status: ReportEmailStatus;
}

/**
 * Sends one report to each address on its own. A failure for one inbox
 * does not skip the rest. Each attempt is its own audit row: who, which
 * report, which address, and when.
 */
export async function deliverReportToEach(
  db: Db,
  input: {
    recipients: string[];
    subject: string;
    body: string;
    entityType: string;
    entityId: number;
    reportName: string;
    performedBy?: number;
  },
): Promise<ReportDelivery[]> {
  const when = new Date().toISOString();
  const results: ReportDelivery[] = [];
  for (const to of input.recipients) {
    let status: ReportEmailStatus = "failed";
    try {
      status = await sendEmail({ to, subject: input.subject, body: input.body });
    } catch (err) {
      logger.error("Report email failed for one recipient", { to, report: input.reportName, err });
      status = "failed";
    }
    await db.insert(notificationLog).values({
      channel: "email",
      recipient: to,
      subject: input.subject,
      body: input.body,
      status,
      relatedEntityType: input.entityType,
      relatedEntityId: input.entityId,
    });
    await recordAuditTrail(db, {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "update",
      changes: { kind: "report_email", report: input.reportName, to, status, when },
      performedBy: input.performedBy,
    });
    results.push({ to, status });
  }
  return results;
}

/** Least-successful outcome, so one failed address is not reported as sent. */
export function overallDeliveryStatus(results: ReportDelivery[]): "sent" | "logged_only" | "failed" {
  if (results.length === 0) return "failed";
  if (results.every((row) => row.status === "sent")) return "sent";
  if (results.some((row) => row.status === "failed")) return "failed";
  return "logged_only";
}
