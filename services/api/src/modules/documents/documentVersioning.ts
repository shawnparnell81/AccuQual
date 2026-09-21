import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { env } from "../../config/env.js";
import { documents, documentFiles, documentVersions } from "../../drizzle/schema/documents.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { workflowDefinitions } from "../../drizzle/schema/workflow.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { audits } from "../../drizzle/schema/audits.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { AppError } from "../../utils/appError.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import * as engine from "../versioning/versioning.service.js";
import type { Actor, Issue, SubjectAdapter } from "../versioning/versioning.service.js";
import {
  blankDocumentPayload,
  diffDocumentVersions,
  LINK_TYPES,
  MAX_ATTACHMENTS,
  nextRevisionCode,
  normalizeDocumentPayload,
  revisionCodeForNumber,
  validateDocumentPayload,
  type DocumentAttachmentRef,
  type DocumentLink,
  type DocumentPayload,
  type LinkType,
} from "./documentPayload.js";

export const DOCUMENT_ENTITY_TYPE = "DocumentVersion";

// ---- Where files live, and what may be stored ----------------------------------------------------------------------------------------------------------

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const tenantStorageRoot = (tenantId: number) => path.resolve(env.STORAGE_LOCAL_PATH, "tenants", String(tenantId));

/** True only for a path inside this organization's own storage folder — the one place a stored file may be read from. */
export function isInsideTenantStorage(tenantId: number, filePath: string): boolean {
  const root = tenantStorageRoot(tenantId) + path.sep;
  return path.resolve(filePath).startsWith(root);
}

interface DetectedType {
  mime: string;
  ext: string;
}

/** What the bytes actually are, not what the client claims. Only these kinds are accepted. */
export function detectFileType(buf: Buffer, originalName: string): DetectedType | null {
  const ext = path.extname(originalName).toLowerCase();
  const head = buf.subarray(0, 12);
  if (head.subarray(0, 4).toString("latin1") === "%PDF" && ext === ".pdf") return { mime: "application/pdf", ext: ".pdf" };
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG" && ext === ".png") return { mime: "image/png", ext: ".png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff && (ext === ".jpg" || ext === ".jpeg")) return { mime: "image/jpeg", ext };
  if (head.subarray(0, 4).toString("latin1") === "GIF8" && ext === ".gif") return { mime: "image/gif", ext: ".gif" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP" && ext === ".webp") return { mime: "image/webp", ext: ".webp" };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ext === ".docx" && buf.includes("word/")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx" };
    if (ext === ".xlsx" && buf.includes("xl/")) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" };
  }
  return null;
}

const cleanName = (name: string) => [...path.basename(name)].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join("").slice(0, 150) || "file";

// ---- Link targets --------------------------------------------------------------------------------------------------------------------------------

/** Names for a set of record ids of one kind, restricted to this organization. Ids that don't exist here are simply absent. */
export async function resolveTargets(db: TenantDb, tenantId: number, type: LinkType, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const out = new Map<number, string>();
  switch (type) {
    case "workflow":
      for (const r of await db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name }).from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, tenantId), inArray(workflowDefinitions.id, ids)))) out.set(r.id, r.name);
      break;
    case "equipment":
      for (const r of await db.select({ id: equipment.id, name: equipment.name, sn: equipment.serialNumber }).from(equipment).where(and(eq(equipment.tenantId, tenantId), inArray(equipment.id, ids)))) out.set(r.id, r.sn ? `${r.name} (${r.sn})` : r.name);
      break;
    case "supplier":
      for (const r of await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, ids)))) out.set(r.id, r.name);
      break;
    case "ncr":
      for (const r of await db.select({ id: ncr.id, title: ncr.title }).from(ncr).where(and(eq(ncr.tenantId, tenantId), eq(ncr.isDeleted, false), inArray(ncr.id, ids)))) out.set(r.id, `NCR #${r.id}: ${r.title}`);
      break;
    case "capa":
      for (const r of await db.select({ id: capa.id, ncrId: capa.ncrId }).from(capa).where(and(eq(capa.tenantId, tenantId), inArray(capa.id, ids)))) out.set(r.id, r.ncrId ? `CAPA #${r.id} (NCR #${r.ncrId})` : `CAPA #${r.id}`);
      break;
    case "audit":
      for (const r of await db.select({ id: audits.id, name: audits.name }).from(audits).where(and(eq(audits.tenantId, tenantId), inArray(audits.id, ids)))) out.set(r.id, r.name);
      break;
    case "training":
      for (const r of await db.select({ id: trainingCourses.id, title: trainingCourses.title }).from(trainingCourses).where(and(eq(trainingCourses.tenantId, tenantId), inArray(trainingCourses.id, ids)))) out.set(r.id, r.title);
      break;
  }
  return out;
}

/** For the link picker: records of one kind whose name matches what was typed. */
export async function searchTargets(db: TenantDb, tenantId: number, type: LinkType, q: string, limit = 15): Promise<{ id: number; label: string }[]> {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const n = Math.min(Math.max(limit, 1), 50);
  switch (type) {
    case "workflow":
      return (await db.select({ id: workflowDefinitions.id, l: workflowDefinitions.name }).from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, tenantId), ilike(workflowDefinitions.name, like))).orderBy(workflowDefinitions.name).limit(n)).map((r) => ({ id: r.id, label: r.l }));
    case "equipment":
      return (await db.select({ id: equipment.id, l: equipment.name, sn: equipment.serialNumber }).from(equipment).where(and(eq(equipment.tenantId, tenantId), or(ilike(equipment.name, like), ilike(equipment.serialNumber, like)))).orderBy(equipment.name).limit(n)).map((r) => ({ id: r.id, label: r.sn ? `${r.l} (${r.sn})` : r.l }));
    case "supplier":
      return (await db.select({ id: suppliers.id, l: suppliers.name }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), ilike(suppliers.name, like))).orderBy(suppliers.name).limit(n)).map((r) => ({ id: r.id, label: r.l }));
    case "ncr":
      return (await db.select({ id: ncr.id, l: ncr.title }).from(ncr).where(and(eq(ncr.tenantId, tenantId), eq(ncr.isDeleted, false), ilike(ncr.title, like))).orderBy(desc(ncr.id)).limit(n)).map((r) => ({ id: r.id, label: `NCR #${r.id}: ${r.l}` }));
    case "capa": {
      const idMatch = /^#?(\d+)$/.exec(q.trim());
      const rows = await db.select({ id: capa.id, ncrId: capa.ncrId }).from(capa).where(and(eq(capa.tenantId, tenantId), idMatch ? eq(capa.id, Number(idMatch[1])) : sql`true`)).orderBy(desc(capa.id)).limit(n);
      return rows.map((r) => ({ id: r.id, label: r.ncrId ? `CAPA #${r.id} (NCR #${r.ncrId})` : `CAPA #${r.id}` }));
    }
    case "audit":
      return (await db.select({ id: audits.id, l: audits.name }).from(audits).where(and(eq(audits.tenantId, tenantId), ilike(audits.name, like))).orderBy(desc(audits.id)).limit(n)).map((r) => ({ id: r.id, label: r.l }));
    case "training":
      return (await db.select({ id: trainingCourses.id, l: trainingCourses.title }).from(trainingCourses).where(and(eq(trainingCourses.tenantId, tenantId), ilike(trainingCourses.title, like))).orderBy(trainingCourses.title).limit(n)).map((r) => ({ id: r.id, label: r.l }));
  }
}

/** Which published documents link to a given record (the reverse of a document's own links). */
export async function documentsLinkedTo(db: TenantDb, tenantId: number, type: LinkType, id: number) {
  const rows = await db
    .select({ id: documents.id, title: documents.title, status: documents.status, revisionCode: documents.revisionCode, currentVersion: documents.currentVersion })
    .from(documents)
    .innerJoin(controlledVersions, eq(controlledVersions.id, documents.currentVersionId))
    .where(and(eq(documents.tenantId, tenantId), eq(documents.isDeleted, false), sql`${controlledVersions.payload} @> ${JSON.stringify({ links: [{ type, id }] })}::jsonb`))
    .orderBy(documents.title);
  return rows;
}

// ---- The adapter ---------------------------------------------------------------------------------------------------------------------------------

async function loadDocument(db: TenantDb, tenantId: number, id: number) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));
  if (!doc || doc.isDeleted) throw AppError.notFound("Document");
  return doc;
}

/** A pre-versioning document's uploaded PDF becomes a registered file, so its first controlled revision can reference it. */
async function registerLegacyFile(db: TenantDb, tenantId: number, documentId: number, version: { version: number; fileUrl: string | null; createdBy: number | null }): Promise<DocumentAttachmentRef | null> {
  const p = version.fileUrl;
  if (!p || /^https?:\/\//i.test(p) || !isInsideTenantStorage(tenantId, p) || !existsSync(p)) return null;
  const [existing] = await db.select().from(documentFiles).where(and(eq(documentFiles.tenantId, tenantId), eq(documentFiles.documentId, documentId), eq(documentFiles.filePath, p)));
  if (existing) return { id: existing.id, fileName: existing.fileName, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes, sha256: existing.sha256 };
  const bytes = readFileSync(p);
  const [row] = await db
    .insert(documentFiles)
    .values({ tenantId, documentId, fileName: `document-${documentId}-rev${version.version}.pdf`, mimeType: "application/pdf", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), filePath: p, uploadedBy: version.createdBy })
    .returning();
  return { id: row!.id, fileName: row!.fileName, mimeType: row!.mimeType, sizeBytes: row!.sizeBytes, sha256: row!.sha256 };
}

export const documentAdapter: SubjectAdapter = {
  subject: "document",
  entityType: DOCUMENT_ENTITY_TYPE,
  noun: "document",
  notifyDepartments: ["quality"],
  notifyReviewLifecycle: true,
  blank: () => ({ ...blankDocumentPayload() }) as unknown as Record<string, unknown>,

  async loadLive(db, tenantId, id) {
    const doc = await loadDocument(db, tenantId, id);
    const number = doc.currentVersion > 0 ? doc.currentVersion : 1;
    const [legacy] = await db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.tenantId, tenantId), eq(documentVersions.version, doc.currentVersion)));
    const file = legacy ? await registerLegacyFile(db, tenantId, doc.id, legacy) : null;
    const payload: DocumentPayload = {
      ...blankDocumentPayload(),
      title: doc.title,
      category: doc.category ?? null,
      revisionCode: doc.revisionCode ?? revisionCodeForNumber(number),
      effectiveDate: doc.effectiveDate ? doc.effectiveDate.toISOString() : null,
      expirationDate: doc.expirationDate ? doc.expirationDate.toISOString() : null,
      retentionPeriodDays: doc.retentionPeriodDays,
      attachments: file ? [file] : [],
    };
    return { payload: payload as unknown as Record<string, unknown>, version: doc.currentVersion, author: legacy?.createdBy ?? doc.ownerId ?? null, exists: true, legacyStatus: doc.status };
  },

  bootstrapStatus: (live) => (live.legacyStatus === "in_review" ? "in_review" : live.legacyStatus === "draft" ? "draft" : "published"),

  async guardDraft(db, tenantId, id) {
    const doc = await loadDocument(db, tenantId, id);
    if (doc.status === "obsolete") throw new AppError("This document is obsolete and can't be revised.", 409);
    if (doc.retentionState === "archived") throw new AppError("This document is archived and can't be revised.", 409);
  },

  seedDraft(payload, ctx) {
    const p = normalizeDocumentPayload(payload);
    const current = normalizeDocumentPayload(ctx.currentPayload ?? payload);
    return { ...p, revisionCode: nextRevisionCode(current.revisionCode), effectiveDate: null } as unknown as Record<string, unknown>;
  },

  validate: (payload) => validateDocumentPayload(payload),

  async checkPayload(db, tenantId, id, versionNumber, payload, stage) {
    const p = normalizeDocumentPayload(payload);
    const issues: Issue[] = [];

    // Every attached file must be a stored file of THIS document in THIS organization, exactly as recorded.
    if (p.attachments.length > 0) {
      const ids = p.attachments.map((a) => a.id).filter((n) => Number.isInteger(n));
      const rows = ids.length === 0 ? [] : await db.select().from(documentFiles).where(and(eq(documentFiles.tenantId, tenantId), eq(documentFiles.documentId, id), inArray(documentFiles.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const a of p.attachments) {
        const row = byId.get(a.id);
        if (!row) issues.push({ code: "attachment_unknown", message: `"${String(a.fileName).slice(0, 80)}" isn't a file of this document. Upload it again.` });
        else if (row.fileName !== a.fileName || row.sha256 !== a.sha256 || row.sizeBytes !== a.sizeBytes || row.mimeType !== a.mimeType) issues.push({ code: "attachment_mismatch", message: `"${row.fileName}" doesn't match the stored file. Reload the page and try again.` });
      }
    }

    // Every link must point at a record that exists in this organization.
    const byType = new Map<LinkType, number[]>();
    for (const l of p.links) if (LINK_TYPES.includes(l.type) && Number.isInteger(l.id)) byType.set(l.type, [...(byType.get(l.type) ?? []), l.id]);
    for (const [type, ids] of byType) {
      const found = await resolveTargets(db, tenantId, type, ids);
      for (const linkId of ids) if (!found.has(linkId)) issues.push({ code: "link_unknown", message: `${type} #${linkId} doesn't exist in this organization.` });
    }

    // A revision code identifies one revision of one document.
    if (stage !== "save" && p.revisionCode.trim()) {
      const others = await db
        .select({ n: controlledVersions.versionNumber, code: sql<string | null>`${controlledVersions.payload}->>'revisionCode'` })
        .from(controlledVersions)
        .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, id), ne(controlledVersions.versionNumber, versionNumber)));
      const clash = others.find((o) => (o.code ?? "").trim().toLowerCase() === p.revisionCode.trim().toLowerCase());
      if (clash) issues.push({ code: "revision_taken", message: `${p.revisionCode} is already used by version ${clash.n} of this document. Choose the next revision code.` });
    }
    return issues;
  },

  async onTransition(db, tenantId, id, event) {
    // While nothing has been released yet the document mirrors its open revision; once released, the released revision stays in force.
    if (event.hasPublished) return;
    const status = event.type === "submitted" || event.type === "approved" ? "in_review" : "draft";
    await db.update(documents).set({ status, updatedAt: new Date() }).where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));
  },

  async apply(db, tenantId, id, payload, info) {
    const p = normalizeDocumentPayload(payload);
    const v = info.version;
    const effective = p.effectiveDate ? new Date(p.effectiveDate) : new Date();
    await db
      .update(documents)
      .set({
        title: p.title.trim(),
        category: p.category,
        currentVersion: info.versionNumber,
        currentVersionId: v.id,
        revisionCode: p.revisionCode.trim(),
        effectiveDate: effective,
        expirationDate: p.expirationDate ? new Date(p.expirationDate) : null,
        ...(p.retentionPeriodDays ? { retentionPeriodDays: p.retentionPeriodDays } : {}),
        linkedModules: [...new Set(p.links.map((l) => l.type))],
        status: "approved",
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));

    // Keep the long-standing revision ledger (history, retention age-out, legacy file download) true for every release.
    const [already] = await db.select({ id: documentVersions.id }).from(documentVersions).where(and(eq(documentVersions.tenantId, tenantId), eq(documentVersions.documentId, id), eq(documentVersions.version, info.versionNumber)));
    if (!already) {
      const primary = p.attachments.find((a) => a.mimeType === "application/pdf") ?? p.attachments[0];
      const [file] = primary ? await db.select({ filePath: documentFiles.filePath }).from(documentFiles).where(and(eq(documentFiles.id, primary.id), eq(documentFiles.tenantId, tenantId))) : [];
      await db.insert(documentVersions).values({
        tenantId,
        documentId: id,
        version: info.versionNumber,
        fileUrl: file?.filePath ?? null,
        changeNotes: typeof v.metadata?.summary === "string" ? (v.metadata.summary as string) : null,
        approvedBy: v.reviewedBy ?? info.actor,
        approvedAt: v.reviewedAt ?? new Date(),
        approvalNotes: v.reviewNotes,
        createdBy: v.createdBy,
      });
    }
    // Same signal the old one-step approval sent, so workflows keyed on "document approved" keep firing.
    await publishEvent(WORKFLOW_STREAM, { tenantId, module: "documents", event: "approved", entityId: id });
  },

  diff: (a, b) => diffDocumentVersions(a, b),
};

// ---- Files on a draft ------------------------------------------------------------------------------------------------------------------------------

async function audit(db: TenantDb, tenantId: number, documentId: number, actor: Actor, changes: Record<string, unknown>) {
  await recordAuditTrail(db, { tenantId, entityType: DOCUMENT_ENTITY_TYPE, entityId: documentId, action: "update", changes, performedBy: actor.id });
}

/** Stores an uploaded file and adds it to the draft. Only a draft can take files; a published revision is frozen. */
export async function addAttachment(db: TenantDb, tenantId: number, documentId: number, versionId: number, actor: Actor, file: { originalname: string; buffer: Buffer; size: number }) {
  const v = await engine.getVersion(db, documentAdapter, tenantId, documentId, versionId);
  if (v.status !== "draft") throw new AppError("Files can only be added to a draft.", 409);
  const payload = normalizeDocumentPayload(v.payload);
  if (payload.attachments.length >= MAX_ATTACHMENTS) throw AppError.badRequest(`A revision can carry at most ${MAX_ATTACHMENTS} files.`);
  if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) throw AppError.badRequest("That file is larger than 15 MB.");
  const type = detectFileType(file.buffer, file.originalname);
  if (!type) throw AppError.badRequest("Only PDF, Word (.docx), Excel (.xlsx) and image (PNG, JPEG, GIF, WebP) files can be attached, and the file's contents must match its type.");

  const dir = path.join(tenantStorageRoot(tenantId), "documents", String(documentId));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${randomUUID()}${type.ext}`);
  await writeFile(filePath, file.buffer);
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  const fileName = cleanName(file.originalname);
  const [row] = await db.insert(documentFiles).values({ tenantId, documentId, fileName, mimeType: type.mime, sizeBytes: file.buffer.length, sha256, filePath, uploadedBy: actor.id }).returning();
  const ref: DocumentAttachmentRef = { id: row!.id, fileName, mimeType: type.mime, sizeBytes: row!.sizeBytes, sha256 };

  const saved = await engine.saveDraft(db, documentAdapter, tenantId, documentId, versionId, actor, { payload: { ...payload, attachments: [...payload.attachments, ref] } as unknown as Record<string, unknown> });
  await audit(db, tenantId, documentId, actor, { event: "attachment_added", version: v.versionNumber, fileId: ref.id, fileName, sizeBytes: ref.sizeBytes, sha256 });
  return { attachment: ref, version: saved };
}

/** Drops a file from the draft. The stored file itself is only deleted when no revision of this document still refers to it. */
export async function removeAttachment(db: TenantDb, tenantId: number, documentId: number, versionId: number, attachmentId: number, actor: Actor) {
  const v = await engine.getVersion(db, documentAdapter, tenantId, documentId, versionId);
  if (v.status !== "draft") throw new AppError("Files can only be removed from a draft.", 409);
  const payload = normalizeDocumentPayload(v.payload);
  const target = payload.attachments.find((a) => a.id === attachmentId);
  if (!target) throw AppError.notFound("Attachment");
  const saved = await engine.saveDraft(db, documentAdapter, tenantId, documentId, versionId, actor, { payload: { ...payload, attachments: payload.attachments.filter((a) => a.id !== attachmentId) } as unknown as Record<string, unknown> });
  await audit(db, tenantId, documentId, actor, { event: "attachment_removed", version: v.versionNumber, fileId: target.id, fileName: target.fileName, sha256: target.sha256 });

  const stillUsed = await db
    .select({ id: controlledVersions.id })
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, documentId), ne(controlledVersions.id, v.id), sql`${controlledVersions.payload} @> ${JSON.stringify({ attachments: [{ id: attachmentId }] })}::jsonb`))
    .limit(1);
  const legacyUse = await db.select({ id: documentVersions.id }).from(documentVersions).innerJoin(documentFiles, eq(documentFiles.filePath, documentVersions.fileUrl)).where(and(eq(documentFiles.id, attachmentId), eq(documentVersions.tenantId, tenantId))).limit(1);
  if (stillUsed.length === 0 && legacyUse.length === 0) {
    const [row] = await db.delete(documentFiles).where(and(eq(documentFiles.id, attachmentId), eq(documentFiles.tenantId, tenantId), eq(documentFiles.documentId, documentId))).returning();
    if (row && isInsideTenantStorage(tenantId, row.filePath)) await unlink(row.filePath).catch(() => undefined);
  }
  return saved;
}

// ---- Signed download links ---------------------------------------------------------------------------------------------------------------------------

const FILE_TOKEN_SECRET = `${env.JWT_ACCESS_SECRET}:document-file`;
export const FILE_LINK_SECONDS = 300;

export function signFileToken(tenantId: number, fileId: number, userId: number): string {
  return jwt.sign({ tid: tenantId, fid: fileId, sub: String(userId), jti: randomUUID() }, FILE_TOKEN_SECRET, { expiresIn: FILE_LINK_SECONDS });
}

export function verifyFileToken(token: string): { tenantId: number; fileId: number; userId: number } {
  try {
    const p = jwt.verify(token, FILE_TOKEN_SECRET) as unknown as { tid: number; fid: number; sub: string };
    return { tenantId: p.tid, fileId: p.fid, userId: Number(p.sub) };
  } catch {
    throw AppError.unauthorized("This download link has expired. Open the document again to get a new one.");
  }
}

export type { DocumentLink };
