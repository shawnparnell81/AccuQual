import { unlink } from "node:fs/promises";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/index.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { scanBuffer, scanFile, virusScanEnabled, type ScanResult } from "../../lib/virusScan.js";
import { recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { formatUserLabel } from "../users/userDisplay.js";

export const SCANNER_UNAVAILABLE_MESSAGE = "Virus scanning is unavailable right now, please try again shortly.";

export function infectedMessage(virus: string): string {
  return `This file was blocked because it contains a virus: ${virus}.`;
}

/** Who and when, as plain words. The time is in the company's time zone. Never throws. */
async function whoAndWhen(userId: number | null | undefined): Promise<{ label: string; when: string }> {
  let timeZone = "UTC";
  let label = "an unknown person";
  try {
    const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
    timeZone = profile?.profile?.timezone || "UTC";
    if (userId) {
      const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
      label = formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, userId);
    }
  } catch (err) {
    logger.warn("Could not look up who uploaded a blocked file", { err });
  }
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label, when };
}

/**
 * One audit entry for a file that was blocked. It is written on its own connection, because the request that
 * is being refused rolls its own transaction back. Never throws.
 */
async function auditBlocked(input: { userId?: number | null; fileName: string; where: string; result: Exclude<ScanResult, { status: "clean" }> }): Promise<void> {
  try {
    const { label, when } = await whoAndWhen(input.userId);
    const reason = input.result.status === "infected" ? `contained ${input.result.virus}` : "could not be scanned because virus scanning was unavailable";
    await recordAuditTrailStandalone(pool, {
      entityType: "UploadBlocked",
      entityId: input.userId ?? 0,
      action: "create",
      changes: {
        summary: `Upload by ${label} blocked: '${input.fileName}' ${reason} (${input.where}) on ${when}.`,
        fileName: input.fileName,
        where: input.where,
        ...(input.result.status === "infected" ? { virus: input.result.virus } : { scanner: "unavailable" }),
      },
      performedBy: input.userId ?? undefined,
    });
  } catch (err) {
    logger.error("Could not record a blocked upload in the audit trail", { err });
  }
}

/**
 * Scans one file before anything is stored or created. An infected file is refused with the virus name, and
 * so is a file the scanner could not check (it fails closed). Both are audit-logged. Does nothing when
 * VIRUS_SCAN_ENABLED resolves to off.
 */
export async function assertUploadClean(input: { buffer?: Buffer; path?: string; fileName: string; userId?: number | null; where: string }): Promise<void> {
  if (!virusScanEnabled()) return;
  const result = input.buffer ? await scanBuffer(input.buffer) : input.path ? await scanFile(input.path) : ({ status: "error", message: "Nothing to scan." } as const);
  if (result.status === "clean") return;
  if (result.status === "error") logger.error("Virus scan failed", { fileName: input.fileName, message: result.message });
  await auditBlocked({ userId: input.userId, fileName: input.fileName, where: input.where, result });
  if (result.status === "infected") throw new AppError(infectedMessage(result.virus), 422);
  throw new AppError(SCANNER_UNAVAILABLE_MESSAGE, 503);
}

type UploadedFile = { originalname?: string; buffer?: Buffer; path?: string };

function filesOf(req: Request): UploadedFile[] {
  const out: UploadedFile[] = [];
  const single = (req as Request & { file?: UploadedFile }).file;
  if (single) out.push(single);
  const many = (req as Request & { files?: UploadedFile[] | Record<string, UploadedFile[]> }).files;
  if (Array.isArray(many)) out.push(...many);
  else if (many) for (const list of Object.values(many)) out.push(...list);
  return out;
}

/**
 * Express middleware for a route that takes an upload. Put it right after the multer step and before
 * anything that stores a file or creates a record. `where` names the place for the audit entry.
 */
export function scanUploads(where: string | ((req: Request) => string | Promise<string>)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const files = filesOf(req);
    if (files.length === 0 || !virusScanEnabled()) return next();
    try {
      let place = typeof where === "string" ? where : "Upload";
      if (typeof where === "function") {
        try {
          place = await where(req);
        } catch {
          // The label is only for the audit entry; a lookup problem must not let a file through or stop the scan.
        }
      }
      for (const file of files) {
        await assertUploadClean({ buffer: file.buffer, path: file.path, fileName: file.originalname || "upload", userId: req.user?.id, where: place });
      }
      next();
    } catch (err) {
      // multer's disk storage already wrote the file. A refused upload leaves nothing behind.
      await Promise.all(files.filter((file) => file.path).map((file) => unlink(file.path!).catch(() => undefined)));
      next(err);
    }
  };
}
