import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { db } from "../../db/index.js";
import { company } from "../../drizzle/schema/company.js";
import { loginEvents } from "../../drizzle/schema/loginEvents.js";
import { logger } from "../../utils/logger.js";
import { lookupIpLocation } from "./ipLocation.js";
import type { SignInClient } from "./signInAudit.js";
import { deviceLabel, parseUserAgent } from "./userAgent.js";

export const LOGIN_EVENT_TYPES = ["signed_in", "sign_in_failed", "signed_out"] as const;
export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

export const LOGIN_EVENT_LABELS: Record<LoginEventType, string> = {
  signed_in: "Signed in",
  sign_in_failed: "Sign-in failed",
  signed_out: "Signed out",
};

/** At least a year. The app does not delete rows. */
export const LOGIN_HISTORY_RETENTION = "Rows are kept. Nothing in the application deletes them before they are a year old.";

export interface LoginEventInput {
  companyId?: number | null;
  userId?: number | null;
  email?: string | null;
  userName?: string | null;
  eventType: LoginEventType;
  success: boolean;
  reason?: string | null;
  method?: string | null;
  client?: SignInClient;
}

export function isUndefinedTable(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code?: string }).code === "42P01") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function clip(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Writes one history row. A missing table (code deployed before the migration)
 * is ignored so sign-in still succeeds. Any other write error is logged and
 * swallowed for the same reason. The password and the token are not arguments.
 */
export async function recordLoginEvent(input: LoginEventInput): Promise<void> {
  try {
    let companyId = input.companyId ?? null;
    if (companyId == null) {
      const [row] = await db.select({ id: company.id }).from(company).limit(1);
      companyId = row?.id ?? null;
    }
    const ip = clip(input.client?.ip, 64);
    const userAgent = clip(input.client?.userAgent, 1024);
    const place = lookupIpLocation(ip);
    const device = parseUserAgent(userAgent, input.client?.platformVersion);
    await db.insert(loginEvents).values({
      companyId,
      userId: input.userId ?? null,
      email: clip(input.email, 320),
      userName: clip(input.userName, 200),
      occurredAt: new Date(),
      eventType: input.eventType,
      success: input.success,
      reason: clip(input.reason, 200),
      method: clip(input.method, 40),
      ipAddress: ip,
      locationCity: place.city,
      locationRegion: place.region,
      locationCountry: place.country,
      userAgent,
      browser: device.browser,
      browserVersion: device.browserVersion,
      os: device.os,
      deviceType: device.deviceType,
    });
  } catch (err) {
    if (isUndefinedTable(err)) {
      logger.warn("Login history table is not in the database yet. This sign-in was not recorded.");
      return;
    }
    logger.error("Failed to record a login event", { err });
  }
}

export interface LoginHistoryQuery {
  user?: string;
  event?: LoginEventType;
  success?: boolean;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface LoginHistoryItem {
  occurredAt: string;
  userName: string | null;
  email: string | null;
  event: LoginEventType;
  eventLabel: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  location: string;
  device: string;
  userAgent: string | null;
}

export interface LoginHistoryPage {
  items: LoginHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  unavailable: boolean;
}

function blankPage(query: LoginHistoryQuery, unavailable: boolean): LoginHistoryPage {
  return { items: [], page: query.page, pageSize: query.pageSize, total: 0, unavailable };
}

function present(row: typeof loginEvents.$inferSelect): LoginHistoryItem {
  const event = (LOGIN_EVENT_TYPES as readonly string[]).includes(row.eventType) ? (row.eventType as LoginEventType) : "signed_in";
  const location = [row.locationCity, row.locationRegion, row.locationCountry].filter((part): part is string => Boolean(part)).join(", ");
  return {
    occurredAt: row.occurredAt.toISOString(),
    userName: row.userName,
    email: row.email,
    event,
    eventLabel: LOGIN_EVENT_LABELS[event],
    success: row.success,
    reason: row.reason,
    ipAddress: row.ipAddress,
    location,
    device: deviceLabel({ browser: row.browser, browserVersion: row.browserVersion, os: row.os, deviceType: row.deviceType }),
    userAgent: row.userAgent,
  };
}

async function companyIdOf(database: Db): Promise<number | null> {
  const [row] = await database.select({ id: company.id }).from(company).limit(1);
  return row?.id ?? null;
}

function filters(companyId: number, query: LoginHistoryQuery): SQL | undefined {
  const parts: SQL[] = [eq(loginEvents.companyId, companyId)];
  const needle = query.user?.trim().replace(/[%_\\]/g, "") ?? "";
  if (needle) {
    const pattern = `%${needle}%`;
    const match = or(ilike(loginEvents.email, pattern), ilike(loginEvents.userName, pattern));
    if (match) parts.push(match);
  }
  if (query.event) parts.push(eq(loginEvents.eventType, query.event));
  if (query.success !== undefined) parts.push(eq(loginEvents.success, query.success));
  if (query.from) parts.push(gte(loginEvents.occurredAt, query.from));
  if (query.to) parts.push(lte(loginEvents.occurredAt, query.to));
  return and(...parts);
}

export async function listLoginEvents(database: Db, query: LoginHistoryQuery): Promise<LoginHistoryPage> {
  try {
    const companyId = await companyIdOf(database);
    if (companyId == null) return blankPage(query, false);
    const where = filters(companyId, query);
    const [countRow] = await database.select({ total: sql<number>`count(*)::int` }).from(loginEvents).where(where);
    const rows = await database
      .select()
      .from(loginEvents)
      .where(where)
      .orderBy(desc(loginEvents.occurredAt), desc(loginEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: rows.map(present),
      page: query.page,
      pageSize: query.pageSize,
      total: countRow?.total ?? 0,
      unavailable: false,
    };
  } catch (err) {
    if (isUndefinedTable(err)) return blankPage(query, true);
    throw err;
  }
}

const EXPORT_CAP = 20_000;

export async function exportLoginEvents(database: Db, query: Omit<LoginHistoryQuery, "page" | "pageSize">): Promise<{ csv: string; truncated: boolean }> {
  const page = await listLoginEvents(database, { ...query, page: 1, pageSize: EXPORT_CAP });
  if (page.unavailable) return { csv: csvDocument([]), truncated: false };
  return { csv: csvDocument(page.items), truncated: page.total > page.items.length };
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function csvDocument(items: LoginHistoryItem[]): string {
  const header = ["Date/Time (UTC)", "User", "Email", "Event", "Result", "Reason", "IP address", "Location", "Device", "User agent"];
  const lines = [header.join(",")];
  for (const item of items) {
    lines.push(
      [
        item.occurredAt,
        item.userName ?? "",
        item.email ?? "",
        item.eventLabel,
        item.success ? "Succeeded" : "Failed",
        item.reason ?? "",
        item.ipAddress ?? "",
        item.location,
        item.device,
        item.userAgent ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
