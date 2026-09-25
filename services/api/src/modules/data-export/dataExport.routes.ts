import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { confirmIdentity } from "../auth/auth.service.js";
import { recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { describeExport, newArchive, writeCompanyExport, type ExportFormat } from "./dataExport.service.js";

/**
 * Company data export. Two steps on purpose:
 *
 *   1. POST /data-export/requests   — an admin re-confirms their password (and two-step code if they use one) and
 *      gets back a short-lived, single-use download link.
 *   2. GET  /data-export/download   — the link streams the ZIP. The token IS the authorization (it is minted only by
 *      step 1), so the browser can simply navigate to it and download natively — no multi-hundred-megabyte file held
 *      in JavaScript memory, and no bearer header needed.
 *
 * Re-confirming the password matters: this endpoint hands over everything the organization has, so a stolen session
 * alone must not be enough.
 */
export const dataExportRouter = Router();

const TOKEN_TTL_SECONDS = 120;
const tokenSecret = `${env.JWT_ACCESS_SECRET}:data-export`;
/** The company is the only "owner" of an export, so limits are counted against one fixed key. */
const COMPANY_KEY = 1;
const MAX_REQUESTS_PER_HOUR = 3;

/** Single-use enforcement and simple throttling. In-process, which is right for the one-API-instance deployment; a second instance would need these moved to Redis. */
const usedTokens = new Map<string, number>();
const requestLog = new Map<number, number[]>();
const running = new Set<number>();

function pruneTokens(): void {
  const now = Date.now();
  for (const [jti, exp] of usedTokens) if (exp < now) usedTokens.delete(jti);
}

/** Test hook. */
export function resetDataExportState(): void {
  usedTokens.clear();
  requestLog.clear();
  running.clear();
}

const requestSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().max(20).optional(),
  format: z.enum(["json", "csv"]).default("json"),
  includeFiles: z.boolean().default(true),
});

interface TokenPayload {
  sub: string;
  fmt: ExportFormat;
  files: boolean;
  jti: string;
}

// What an export would contain, with counts. Admin only.
dataExportRouter.get(
  "/contents",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await describeExport());
  }),
);

dataExportRouter.post(
  "/requests",
  authRateLimiter,
  requireAuth,
  requireRole("admin"),
  validate(requestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof requestSchema>;

    await confirmIdentity(req.user!.id, body.password, body.code);

    const now = Date.now();
    const recent = (requestLog.get(COMPANY_KEY) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= MAX_REQUESTS_PER_HOUR) throw new AppError("Too many exports requested. Try again in a while.", 429);
    if (running.has(COMPANY_KEY)) throw new AppError("An export is already running.", 409);
    requestLog.set(COMPANY_KEY, [...recent, now]);

    const token = jwt.sign({ sub: String(req.user!.id), fmt: body.format, files: body.includeFiles, jti: randomUUID() } satisfies TokenPayload, tokenSecret, { expiresIn: TOKEN_TTL_SECONDS });
    await recordAuditTrailStandalone(pool, { entityType: "Company", entityId: COMPANY_KEY, action: "status_change", changes: { event: "data_export_requested", format: body.format, includeFiles: body.includeFiles }, performedBy: req.user!.id });
    res.json({ downloadUrl: `/data-export/download?token=${encodeURIComponent(token)}`, expiresInSeconds: TOKEN_TTL_SECONDS });
  }),
);

dataExportRouter.get(
  "/download",
  asyncHandler(async (req: Request, res: Response) => {
    let payload: TokenPayload;
    try {
      payload = jwt.verify(String(req.query.token ?? ""), tokenSecret) as unknown as TokenPayload;
    } catch {
      throw AppError.unauthorized("This download link has expired. Request the export again.");
    }
    pruneTokens();
    if (usedTokens.has(payload.jti)) throw AppError.unauthorized("This download link was already used. Request the export again.");
    usedTokens.set(payload.jti, Date.now() + TOKEN_TTL_SECONDS * 1000);

    // The link was minted for an admin; make sure they still are one, still.
    const [row] = await db
      .select({ id: users.id, email: users.email, isActive: users.isActive, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, Number(payload.sub))));
    if (!row || !row.isActive || (row.roleName !== "admin" && row.roleName !== "platform_admin")) throw AppError.forbidden("This account can no longer export data.");
    if (running.has(COMPANY_KEY)) throw new AppError("An export is already running.", 409);

    running.add(COMPANY_KEY);
    const startedAt = Date.now();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="accuqual-export-${stamp}.zip"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = newArchive();
    let finished = false;
    const audit = (event: string, extra: Record<string, unknown> = {}) =>
      recordAuditTrailStandalone(pool, { entityType: "Company", entityId: COMPANY_KEY, action: "status_change", changes: { event, format: payload.fmt, includeFiles: payload.files, ...extra }, performedBy: row.id });

    archive.on("error", (err) => {
      logger.error("Data export archive failed", { err: String(err) });
      res.destroy(err);
    });
    res.on("close", () => {
      running.delete(COMPANY_KEY);
      if (!finished) void audit("data_export_aborted", { afterMs: Date.now() - startedAt });
    });
    archive.pipe(res);

    try {
      const manifest = await writeCompanyExport(archive, { userId: row.id, email: row.email }, { format: payload.fmt, includeFiles: payload.files });
      await archive.finalize();
      finished = true;
      await audit("data_export_completed", { tables: manifest.tables.length, rows: manifest.totalRows, files: manifest.files.included, filesSkipped: manifest.files.skipped.length, truncatedTables: manifest.tables.filter((t) => t.truncated).map((t) => t.name), ms: Date.now() - startedAt });
    } catch (err) {
      logger.error("Data export failed", { err: String(err) });
      await audit("data_export_failed", { error: (err as Error).message.slice(0, 200) });
      archive.abort();
      res.destroy(err as Error);
    }
  }),
);
