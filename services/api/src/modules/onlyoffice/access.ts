import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, ne, sql } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { AppError } from "../../utils/appError.js";
import { documentFiles } from "../../drizzle/schema/documents.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { hasPermission, type PermissionName } from "../../middleware/requirePermission.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { normalizeDocumentPayload, type DocumentAttachmentRef } from "../documents/documentPayload.js";
import { detectFileType, documentAdapter, isInsideTenantStorage, MAX_FILE_BYTES } from "../documents/documentVersioning.js";
import * as engine from "../versioning/versioning.service.js";
import { officeDocumentType } from "./editorConfig.js";

/**
 * The only access check for in-app Office editing.
 *
 * It reuses the document permission helper (`document.view` / `document.edit`) and the same
 * attachment rule as the signed download link: the file id has to be on that revision, and the
 * bytes have to live in document storage. Company scoping stays inside this file — `hasPermission`
 * and the version lookup already take it — so removing tenancy means simplifying this module,
 * not the editor, the callback, or the tests.
 */
export interface OfficeActor {
  id: number;
  tenantId: number | null;
  roleName: string | null;
  department: string | null;
  name: string;
}

export interface OfficeTarget {
  documentId: number;
  versionId: number;
  fileId: number;
}

export interface OfficeStoredFile {
  fileId: number;
  status: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  filePath: string;
  /** True when another revision of this document still points at the same file id. */
  sharedWithOtherRevision: boolean;
}

export type OfficeAuthorization =
  | { ok: true; mode: "view" | "edit"; file: OfficeStoredFile }
  | { ok: false; status: 403 | 404 | 415; reason: string };

type PermissionCheck = (
  db: TenantDb,
  tenantId: number,
  user: { id: number; roleName: string | null; department: string | null },
  name: PermissionName,
) => Promise<{ allowed: boolean; reason?: string }>;

export interface OfficeAccessDeps {
  hasPermission: PermissionCheck;
  loadFile: (db: TenantDb, tenantId: number, ids: OfficeTarget) => Promise<OfficeStoredFile | null>;
}

export function decideOfficeAccess(
  view: { allowed: boolean; reason?: string },
  edit: { allowed: boolean; reason?: string },
  file: Pick<OfficeStoredFile, "status" | "fileName"> | null,
): { ok: true; mode: "view" | "edit" } | { ok: false; status: 403 | 404 | 415; reason: string } {
  if (!view.allowed) return { ok: false, status: 403, reason: view.reason ?? "You don't have permission to view this document." };
  if (!file) return { ok: false, status: 404, reason: "Attachment not found" };
  if (!officeDocumentType(file.fileName)) return { ok: false, status: 415, reason: "Only Word (.docx) and Excel (.xlsx) files can be opened in the editor." };
  if (edit.allowed && file.status === "draft") return { ok: true, mode: "edit" };
  return { ok: true, mode: "view" };
}

export function assertOfficeAccess(result: OfficeAuthorization): asserts result is { ok: true; mode: "view" | "edit"; file: OfficeStoredFile } {
  if (result.ok) return;
  if (result.status === 404) throw AppError.notFound("Attachment");
  if (result.status === 403) throw AppError.forbidden(result.reason);
  throw new AppError(result.reason, result.status);
}

async function sharedWithOtherRevision(db: TenantDb, tenantId: number, documentId: number, versionId: number, fileId: number): Promise<boolean> {
  const [hit] = await db
    .select({ id: controlledVersions.id })
    .from(controlledVersions)
    .where(
      and(
        eq(controlledVersions.tenantId, tenantId),
        eq(controlledVersions.subjectType, "document"),
        eq(controlledVersions.subjectId, documentId),
        ne(controlledVersions.id, versionId),
        sql`${controlledVersions.payload} @> ${JSON.stringify({ attachments: [{ id: fileId }] })}::jsonb`,
      ),
    )
    .limit(1);
  return Boolean(hit);
}

async function loadRevisionFile(db: TenantDb, tenantId: number, ids: OfficeTarget): Promise<OfficeStoredFile | null> {
  let version: { status: string; payload: Record<string, unknown> };
  try {
    version = await engine.getVersion(db, documentAdapter, tenantId, ids.documentId, ids.versionId);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) return null;
    throw err;
  }
  const payload = normalizeDocumentPayload(version.payload);
  if (!payload.attachments.some((a) => a.id === ids.fileId)) return null;
  const [row] = await db
    .select()
    .from(documentFiles)
    .where(and(eq(documentFiles.id, ids.fileId), eq(documentFiles.documentId, ids.documentId), eq(documentFiles.tenantId, tenantId)));
  if (!row || !isInsideTenantStorage(tenantId, row.filePath) || !existsSync(row.filePath)) return null;
  return {
    fileId: row.id,
    status: version.status,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    filePath: row.filePath,
    sharedWithOtherRevision: await sharedWithOtherRevision(db, tenantId, ids.documentId, ids.versionId, ids.fileId),
  };
}

const defaultDeps: OfficeAccessDeps = { hasPermission, loadFile: loadRevisionFile };

export async function loadOfficeActor(db: TenantDb, userId: number): Promise<OfficeActor | null> {
  const [row] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      department: users.department,
      isActive: users.isActive,
      name: users.name,
      email: users.email,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId));
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    roleName: row.roleName,
    department: row.department,
    name: row.name?.trim() || row.email,
  };
}

export async function authorizeOfficeFile(db: TenantDb, actor: OfficeActor, ids: OfficeTarget, deps: OfficeAccessDeps = defaultDeps): Promise<OfficeAuthorization> {
  if (actor.tenantId == null) return { ok: false, status: 403, reason: "Missing company context" };
  const view = await deps.hasPermission(db, actor.tenantId, actor, "document.view");
  if (!view.allowed) {
    const denied = decideOfficeAccess(view, { allowed: false }, null);
    return denied.ok ? { ok: false, status: 403, reason: "You don't have permission to view this document." } : denied;
  }
  const [edit, file] = await Promise.all([deps.hasPermission(db, actor.tenantId, actor, "document.edit"), deps.loadFile(db, actor.tenantId, ids)]);
  const decision = decideOfficeAccess(view, edit, file);
  if (!decision.ok) return decision;
  if (!file) return { ok: false, status: 404, reason: "Attachment not found" };
  return { ok: true, mode: decision.mode, file };
}

/**
 * A published revision must keep the bytes it was released with. If this draft still points at a
 * file another revision uses, copy it onto the draft first so later saves cannot change the other one.
 */
export async function ensureExclusiveDraftFile(db: TenantDb, actor: OfficeActor, ids: OfficeTarget, file: OfficeStoredFile): Promise<OfficeStoredFile> {
  if (!file.sharedWithOtherRevision) return file;
  if (actor.tenantId == null) throw AppError.forbidden("Missing company context");
  const bytes = await readFile(file.filePath);
  const ext = path.extname(file.fileName).toLowerCase();
  const dir = path.dirname(file.filePath);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${randomUUID()}${ext}`);
  if (!isInsideTenantStorage(actor.tenantId, filePath)) throw AppError.badRequest("Refusing to store the file outside document storage.");
  await writeFile(filePath, bytes);
  try {
    const [row] = await db
      .insert(documentFiles)
      .values({
        tenantId: actor.tenantId,
        documentId: ids.documentId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        filePath,
        uploadedBy: actor.id,
      })
      .returning();
    const version = await engine.getVersion(db, documentAdapter, actor.tenantId, ids.documentId, ids.versionId);
    const payload = normalizeDocumentPayload(version.payload as Record<string, unknown>);
    const ref: DocumentAttachmentRef = { id: row!.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256 };
    await engine.saveDraft(db, documentAdapter, actor.tenantId, ids.documentId, ids.versionId, { id: actor.id, roleName: actor.roleName }, {
      payload: { ...payload, attachments: payload.attachments.map((a) => (a.id === ids.fileId ? ref : a)) } as unknown as Record<string, unknown>,
    });
    return { ...file, fileId: row!.id, filePath, sharedWithOtherRevision: false };
  } catch (err) {
    await unlink(filePath).catch(() => undefined);
    throw err;
  }
}

export interface SavedOfficeFile {
  fileId: number;
  oldPath: string;
  newPath: string;
}

/** Writes a document-server save back onto the draft. Refuses anything that is not an editable draft. */
export async function persistEditedOfficeFile(db: TenantDb, actor: OfficeActor, ids: OfficeTarget, bytes: Buffer): Promise<SavedOfficeFile> {
  const access = await authorizeOfficeFile(db, actor, ids);
  assertOfficeAccess(access);
  if (access.mode !== "edit") throw new AppError("This revision is not a draft, so the editor can't save it.", 409);
  if (access.file.sharedWithOtherRevision) throw new AppError("This file is still shared with another revision. Close the editor and open it again.", 409);
  if (bytes.length > MAX_FILE_BYTES) throw AppError.badRequest("The saved file is larger than 15 MB.");
  const detected = detectFileType(bytes, access.file.fileName);
  if (!detected) throw AppError.badRequest("The saved file isn't a valid Word or Excel document.");
  if (detected.ext !== path.extname(access.file.fileName).toLowerCase()) throw AppError.badRequest("The saved file type doesn't match the original.");
  if (actor.tenantId == null) throw AppError.forbidden("Missing company context");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const nextPath = path.join(path.dirname(access.file.filePath), `${randomUUID()}${detected.ext}`);
  if (!isInsideTenantStorage(actor.tenantId, nextPath)) throw AppError.badRequest("Refusing to store the file outside document storage.");
  await writeFile(nextPath, bytes);
  try {
    await db
      .update(documentFiles)
      .set({ filePath: nextPath, sha256, sizeBytes: bytes.length, mimeType: detected.mime })
      .where(and(eq(documentFiles.id, ids.fileId), eq(documentFiles.documentId, ids.documentId), eq(documentFiles.tenantId, actor.tenantId)));
    const version = await engine.getVersion(db, documentAdapter, actor.tenantId, ids.documentId, ids.versionId);
    const payload = normalizeDocumentPayload(version.payload as Record<string, unknown>);
    const attachments = payload.attachments.map((a) => (a.id === ids.fileId ? { ...a, sha256, sizeBytes: bytes.length, mimeType: detected.mime } : a));
    await engine.saveDraft(db, documentAdapter, actor.tenantId, ids.documentId, ids.versionId, { id: actor.id, roleName: actor.roleName }, {
      payload: { ...payload, attachments } as unknown as Record<string, unknown>,
    });
    await recordAuditTrail(db, {
      tenantId: actor.tenantId,
      entityType: "DocumentVersion",
      entityId: ids.documentId,
      action: "update",
      changes: { event: "office_file_saved", fileId: ids.fileId, fileName: access.file.fileName, sha256, sizeBytes: bytes.length },
      performedBy: actor.id,
    });
  } catch (err) {
    await unlink(nextPath).catch(() => undefined);
    throw err;
  }
  return { fileId: ids.fileId, oldPath: access.file.filePath, newPath: nextPath };
}
