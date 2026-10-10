import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { company } from "../../drizzle/schema/company.js";
import { roles } from "../../drizzle/schema/roles.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { roleHasLoginHistoryPermission } from "../roles/roleAccess.js";
import { LOGIN_EVENT_TYPES, exportLoginEvents, listLoginEvents, readRecordingStart, type LoginEventType, type LoginHistoryQuery } from "./loginEvents.js";
import { parseRecordingStart, recordingOpen, recordingStartNotice, utcToEasternWall } from "./loginHistoryStart.js";

const FORBIDDEN = "Login history is limited to roles an administrator has allowed to see it.";

/** The role's permission list is the only check. A role name does not grant this. */
export const requireLoginHistory = asyncHandler(async (req: Request, _res: Response, next) => {
  const roleName = req.user?.roleName;
  if (!roleName || !req.db) throw AppError.forbidden(FORBIDDEN);
  const [role] = await (req.db as Db).select({ permissions: roles.permissions }).from(roles).where(eq(roles.name, roleName));
  if (!roleHasLoginHistoryPermission(role?.permissions)) throw AppError.forbidden(FORBIDDEN);
  next();
});

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function parseInstant(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw AppError.badRequest("That date is not valid.");
    return date;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw AppError.badRequest("That date is not valid.");
  return date;
}

function readFilters(req: Request): Omit<LoginHistoryQuery, "page" | "pageSize"> {
  const event = optionalText(req.query.event, 40);
  if (event && !(LOGIN_EVENT_TYPES as readonly string[]).includes(event)) throw AppError.badRequest("That event type is not valid.");
  const successText = optionalText(req.query.success, 10);
  if (successText && successText !== "true" && successText !== "false") throw AppError.badRequest("Result must be succeeded or failed.");
  return {
    user: optionalText(req.query.user, 200),
    event: event as LoginEventType | undefined,
    success: successText === undefined ? undefined : successText === "true",
    from: parseInstant(optionalText(req.query.from, 40), false),
    to: parseInstant(optionalText(req.query.to, 40), true),
  };
}

function readPage(req: Request): LoginHistoryQuery {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 25);
  if (!Number.isInteger(page) || page < 1) throw AppError.badRequest("Page must be a whole number.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw AppError.badRequest("Page size must be from 1 to 100.");
  return { ...readFilters(req), page, pageSize };
}

export const listLoginHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listLoginEvents(req.db as Db, readPage(req)));
});

export const updateLoginHistoryStartHandler = asyncHandler(async (req: Request, res: Response) => {
  const raw = (req.body as { startsAt?: unknown } | undefined)?.startsAt;
  if (typeof raw !== "string") throw AppError.badRequest("That start time is not valid.");
  const next = parseRecordingStart(raw);
  if (!next) throw AppError.badRequest("That start time is not valid.");
  const database = req.db as Db;
  const [co] = await database.select().from(company).limit(1);
  if (!co) throw AppError.notFound("Company");
  const previous = await readRecordingStart(database);
  const nextIso = next.toISOString();
  if (next.getTime() !== previous.getTime()) {
    await database.update(company).set({ profile: { ...co.profile, loginHistoryStartsAt: nextIso } }).where(eq(company.id, co.id));
    await recordAuditTrail(database, {
      entityType: "Company",
      entityId: co.id,
      action: "update",
      changes: { setting: "loginHistoryStartsAt", from: previous.toISOString(), to: nextIso },
      performedBy: req.user?.id,
    });
  }
  const open = recordingOpen(next);
  res.json({
    recordingStartsAt: nextIso,
    recordingStartsAtEastern: utcToEasternWall(next),
    recording: open,
    recordingNotice: open ? null : recordingStartNotice(next),
  });
});

export const exportLoginHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { csv, truncated } = await exportLoginEvents(req.db as Db, readFilters(req));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="login-history.csv"');
  if (truncated) res.setHeader("X-Export-Truncated", "1");
  res.send(csv);
});
