import type { Request, Response } from "express";
import { and, eq, gte, ne, or, sql } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { audits } from "../../drizzle/schema/audits.js";
import { trainingAssignments, trainingCourses } from "../../drizzle/schema/training.js";
import { documents } from "../../drizzle/schema/documents.js";
import { crarClaims } from "../../drizzle/schema/crar.js";
import { expirationStatus } from "../documents/documents.controller.js";

export type CalendarModule = "ncr" | "capa" | "audit" | "training" | "document" | "crar";

export interface CalendarItem {
  id: string;
  title: string;
  module: CalendarModule;
  dueDate: string | null;
  status: string;
  link: string;
  /** True once the item has reached a terminal (closed/completed/approved) state. */
  isTerminal: boolean;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Everything that needs a given user's attention, plus anything of theirs
 * that reached a terminal state this month (so a "completed this month"
 * stat has real data) — see plan §"Design decisions" #1. Extracted so it
 * can be reused for two different callers: the self-service Calendar
 * below (always `req.user.id`, never a client-supplied id — see
 * nav.controller.ts's getKpiCounts for the same precedent) and Worker
 * Runtime's `getWorkerActivity` (a permission-gated *other* user's id,
 * for a manager looking at someone's workload) — see
 * `modules/worker/worker.controller.ts`. One aggregation, two access
 * rules layered on top of it, not two copies of the aggregation itself.
 */
function plantLimit(siteId: number | null | undefined, column: unknown) {
  if (siteId === undefined) return undefined;
  if (siteId === null) return sql`false`;
  return eq(column as never, siteId);
}

export async function getItemsForUser(db: TenantDb, userId: number, siteId?: number | null): Promise<CalendarItem[]> {
  const monthStart = startOfMonth();

  const [myNcrs, myCapas, myAudits, myTraining, myDocuments, myCrars] = await Promise.all([
    db
      .select({ id: ncr.id, title: ncr.title, status: ncr.status, dueDate: ncr.dueDate, closedAt: ncr.closedAt })
      .from(ncr)
      .where(
        and(
          plantLimit(siteId, ncr.siteId), eq(ncr.assignedTo, userId), eq(ncr.isDeleted, false), or(ne(ncr.status, "closed"), gte(ncr.closedAt, monthStart)),
        ),
      ),
    db
      .select({ id: capa.id, status: capa.status, dueDate: capa.dueDate, closedAt: capa.closedAt, ownerId: capa.ownerId, verifiedBy: capa.verifiedBy })
      .from(capa)
      .where(
        and(
          plantLimit(siteId, capa.siteId), or(eq(capa.ownerId, userId), eq(capa.verifiedBy, userId)), or(ne(capa.status, "closed"), gte(capa.closedAt, monthStart)),
        ),
      ),
    db
      .select({ id: audits.id, name: audits.name, status: audits.status, scheduledAt: audits.scheduledAt, completedAt: audits.completedAt })
      .from(audits)
      .where(
        and(
          plantLimit(siteId, audits.siteId), eq(audits.auditorId, userId), or(ne(audits.status, "completed"), gte(audits.completedAt, monthStart)),
        ),
      ),
    db
      .select({
        id: trainingAssignments.id,
        status: trainingAssignments.status,
        dueAt: trainingAssignments.dueAt,
        completedAt: trainingAssignments.completedAt,
        courseTitle: trainingCourses.title,
      })
      .from(trainingAssignments)
      .innerJoin(trainingCourses, eq(trainingAssignments.courseId, trainingCourses.id))
      .where(
        and(
          eq(trainingAssignments.userId, userId), or(ne(trainingAssignments.status, "completed"), gte(trainingAssignments.completedAt, monthStart)),
        ),
      ),
    db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        expirationDate: documents.expirationDate,
        expirationWarningDays: documents.expirationWarningDays,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.ownerId, userId), eq(documents.isDeleted, false))),
    db
      .select({
        id: crarClaims.id,
        customerClaim: crarClaims.customerClaim,
        status: crarClaims.status,
        targetCompletion: crarClaims.targetCompletion,
        updatedAt: crarClaims.updatedAt,
      })
      .from(crarClaims)
      .where(
        and(
          eq(crarClaims.createdByUserId, userId), or(ne(crarClaims.status, "completed"), gte(crarClaims.updatedAt, monthStart)),
        ),
      ),
  ]);

  const items: CalendarItem[] = [
    ...myNcrs.map((row): CalendarItem => {
      const isTerminal = row.status === "closed";
      const overdue = !isTerminal && row.dueDate != null && row.dueDate < new Date();
      return {
        id: `ncr-${row.id}`,
        title: row.title,
        module: "ncr",
        dueDate: row.dueDate ? row.dueDate.toISOString() : null,
        status: overdue ? "overdue" : row.status,
        link: `/ncr/${row.id}`,
        isTerminal,
      };
    }),
    ...myCapas.map((row): CalendarItem => {
      const isTerminal = row.status === "closed";
      const overdue = !isTerminal && row.dueDate != null && row.dueDate < new Date();
      return {
        id: `capa-${row.id}`,
        title: `CAPA #${row.id}`,
        module: "capa",
        dueDate: row.dueDate ? row.dueDate.toISOString() : null,
        status: overdue ? "overdue" : row.status,
        link: `/capa/${row.id}`,
        isTerminal,
      };
    }),
    ...myAudits.map((row): CalendarItem => ({
      id: `audit-${row.id}`,
      title: row.name,
      module: "audit",
      dueDate: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      status: row.status,
      link: `/audits/${row.id}`,
      isTerminal: row.status === "completed",
    })),
    ...myTraining.map((row): CalendarItem => {
      const isTerminal = row.status === "completed";
      const overdue = !isTerminal && row.dueAt != null && row.dueAt < new Date();
      return {
        id: `training-${row.id}`,
        title: row.courseTitle,
        module: "training",
        dueDate: row.dueAt ? row.dueAt.toISOString() : null,
        status: overdue ? "overdue" : row.status,
        link: `/training/${row.id}`,
        isTerminal,
      };
    }),
    ...myDocuments
      .map((row): CalendarItem | null => {
        const expStatus = expirationStatus(row);
        const needsAttention = row.status === "in_review" || expStatus !== null;
        const approvedThisMonth = row.status === "approved" && row.updatedAt != null && row.updatedAt >= monthStart;
        if (!needsAttention && !approvedThisMonth) return null;
        return {
          id: `document-${row.id}`,
          title: row.title,
          module: "document",
          dueDate: row.expirationDate ? row.expirationDate.toISOString() : null,
          status: expStatus ?? row.status,
          link: `/documents/${row.id}`,
          isTerminal: row.status === "approved" || row.status === "obsolete",
        };
      })
      .filter((item): item is CalendarItem => item !== null),
    ...myCrars.map((row): CalendarItem => {
      const isTerminal = row.status === "completed";
      const overdue = !isTerminal && row.targetCompletion != null && row.targetCompletion < new Date();
      return {
        id: `crar-${row.id}`,
        title: row.customerClaim ?? `CRAR #${row.id}`,
        module: "crar",
        dueDate: row.targetCompletion ? row.targetCompletion.toISOString() : null,
        status: overdue ? "overdue" : row.status,
        link: `/crar/${row.id}`,
        isTerminal,
      };
    }),
  ];

  items.sort((a, b) => {
    if (a.dueDate == null && b.dueDate == null) return 0;
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return items;
}

export const getCalendarItems = asyncHandler(async (req: Request, res: Response) => {
  const items = await getItemsForUser(req.db!, req.user!.id, req.siteId ?? null);
  res.json(items);
});
