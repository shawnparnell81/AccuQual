import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { documentFolders, LIBRARY_POOL_NAME } from "../../drizzle/schema/documentFolders.js";
import { documents } from "../../drizzle/schema/documents.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { DEFAULT_DOCUMENT_FOLDERS, type DefaultFolderSeed } from "./defaultDocumentFolders.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { expirationStatus } from "../documents/documents.controller.js";

// A separate entityType from "Document" (services/api/src/modules/documents)
// — document_folders.id and documents.id are different id spaces, and
// keeping them under distinct entityTypes is what makes an audit_trail row
// unambiguous about which table entityId points into.
const AUDIT_ENTITY_TYPE = "DocumentFolder";

/**
 * Inserts one level of the default tree at a time (each level needs the
 * previous level's real auto-increment ids as `parentId`, so this can't be a
 * single bulk insert). Only ever runs once per tenant — see `list` below.
 */
async function seedDefaults(db: TenantDb, tenantId: number): Promise<void> {
  async function insertLevel(nodes: DefaultFolderSeed[], parentId: number | null): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const [created] = await db
        .insert(documentFolders)
        .values({ tenantId, name: node.name, parentId: parentId ?? undefined, sortOrder: i })
        .returning();
      if (!created) throw new Error("Insert did not return the created document folder");
      if (node.children.length > 0) await insertLevel(node.children, created.id);
    }
  }
  await insertLevel(DEFAULT_DOCUMENT_FOLDERS, null);
}

/**
 * Ensures the tenant has a top-level "Library Pool" node — the one place
 * "remove this form" moves a leaf to (see the schema comment). Runs on every
 * `list` call rather than only during initial seeding, so it self-heals for
 * tenants that already existed before this feature shipped, and even
 * recreates it if a user ever deletes it.
 */
async function ensureLibraryPool(db: TenantDb, tenantId: number, topLevel: (typeof documentFolders.$inferSelect)[]): Promise<typeof documentFolders.$inferSelect> {
  const existingPool = topLevel.find((f) => f.name === LIBRARY_POOL_NAME);
  if (existingPool) return existingPool;
  const siblingCount = topLevel.length;
  const [created] = await db.insert(documentFolders).values({ tenantId, name: LIBRARY_POOL_NAME, sortOrder: siblingCount }).returning();
  if (!created) throw new AppError("Failed to create the library pool folder", 500);
  return created;
}

/**
 * The "few out of the entire library" leaves whose name plainly names one of
 * the app's real, working QMS modules — linking them means clicking that
 * document opens the live module instead of (or alongside) a static file.
 * Order matters: more specific patterns first, so e.g. "Complaint 8Ds"
 * matches the 8D rule rather than the broader Complaints rule below it.
 * Anything naming a *procedure about* the process (not the record type
 * itself) is deliberately excluded — a "Corrective Action Procedure" is an
 * SOP document, not a CAPA record.
 */
const FORM_LINK_RULES: { pattern: RegExp; path: string }[] = [
  { pattern: /\b8d'?s?\b/i, path: "/8d" },
  { pattern: /\bcapa\b/i, path: "/capa" },
  { pattern: /\bcorrective actions?\b/i, path: "/capa" },
  { pattern: /\bncr'?s?\b/i, path: "/ncr" },
  { pattern: /\bnonconformance\b/i, path: "/ncr" },
  { pattern: /\bppap\b/i, path: "/ppap" },
  { pattern: /\bcalibration\b/i, path: "/calibration" },
  { pattern: /\bsupplier (audit|scorecard)/i, path: "/suppliers" },
  { pattern: /\b(customer )?complaints?\b/i, path: "/complaints" },
  { pattern: /\b(internal|external) audit\b|\baudit checklist\b/i, path: "/audits" },
  { pattern: /\btraining records?\b/i, path: "/training" },
  { pattern: /\b(engineering )?change (request|order)/i, path: "/change" },
  { pattern: /\b[dp]fmea\b/i, path: "/risk" },
  { pattern: /\brisk assessments?\b/i, path: "/risk" },
  { pattern: /\bequipment master list\b/i, path: "/calibration" },
  { pattern: /\bwork orders?\b|\btravelers?\s*\/?\s*routers?\b/i, path: "/work-orders" },
  { pattern: /\bchange request form\b/i, path: "/document-change-requests" },
  // The generic "ACCUQUAL Forms" batch (see qmsFormDefinitions.ts) — every
  // one of these is a distinct QMS record type this app has no other real
  // module for, so each gets its own real /qms-forms/:formType link
  // instead of a static file slot.
  { pattern: /\brevision history\b/i, path: "/qms-forms/document_revision_record" },
  { pattern: /\bmaster document list\b/i, path: "/qms-forms/master_document_register" },
  { pattern: /\brecord retention log\b/i, path: "/qms-forms/record_retention_log" },
  { pattern: /\bquality objectives\b/i, path: "/qms-forms/quality_objectives_action_plan" },
  { pattern: /\bpreventive actions?\b/i, path: "/qms-forms/preventive_risk_action" },
  { pattern: /\bsupplier qualification\b/i, path: "/qms-forms/supplier_qualification_evaluation" },
  { pattern: /\bpo quality requirements\b/i, path: "/qms-forms/po_quality_requirements" },
  { pattern: /\bincoming inspection record\b|\breceiving inspection form\b/i, path: "/qms-forms/incoming_inspection_record" },
  { pattern: /\bfirst article inspection\b/i, path: "/qms-forms/first_article_inspection" },
  { pattern: /\bin-process inspection\b/i, path: "/qms-forms/in_process_inspection" },
  { pattern: /\bfinal inspection\b/i, path: "/qms-forms/final_inspection_release" },
  { pattern: /\btraining matrix\b/i, path: "/qms-forms/training_matrix" },
  { pattern: /\bcustomer satisfaction\b/i, path: "/qms-forms/customer_satisfaction_record" },
  { pattern: /\blot traceability\b/i, path: "/qms-forms/product_traceability_record" },
  { pattern: /\bdeviation\s*\/?\s*waiver requests?\b/i, path: "/qms-forms/deviation_waiver_request" },
  { pattern: /\bchange control records?\b/i, path: "/qms-forms/change_control_record" },
  { pattern: /\bmanagement review\b/i, path: "/qms-forms/management_review_record" },
  { pattern: /\bquality kpis?\b/i, path: "/qms-forms/quality_kpi_monitoring" },
  { pattern: /\benvironmental condition\b/i, path: "/qms-forms/environmental_condition_record" },
  { pattern: /\baudit findings\b/i, path: "/qms-forms/audit_finding_action_log" },
  { pattern: /\bquality record disposition\b/i, path: "/qms-forms/quality_record_disposition" },
  { pattern: /\bdhf\b|\bdesign history\b/i, path: "/qms-forms/design_history_form" },
  // The two real gaps reported by the ACCUQUAL Forms batch review, since
  // filled with their own real supplied forms.
  { pattern: /\bscar\b/i, path: "/scar-forms" },
  { pattern: /\binspection forms?\b/i, path: "/quality-inspection-reports" },
];

/**
 * The 9 subfolders added to DEFAULT_DOCUMENT_FOLDERS by the "ACCUQUAL
 * Forms" batch (see qmsFormDefinitions.ts) after many tenants had already
 * been seeded — backfilled here for any tenant whose tree already existed,
 * same self-healing idea as ensureLibraryPool/linkKnownForms rather than a
 * one-off migration script (which could never reach a tenant created after
 * it ran anyway; this reaches every tenant, always).
 */
const ADDITIONAL_SUBFOLDERS: { department: string; folder: string; subfolder: string }[] = [
  { department: "Quality", folder: "Document Control", subfolder: "Record Retention Log" },
  { department: "Quality", folder: "Document Control", subfolder: "Quality Record Disposition" },
  { department: "Quality", folder: "Quality Manual & Policies", subfolder: "Quality Objectives & Action Plans" },
  { department: "Quality", folder: "Quality Manual & Policies", subfolder: "Management Review Records" },
  { department: "Quality", folder: "Nonconformance Management", subfolder: "Deviation / Waiver Requests" },
  { department: "Production", folder: "Safety & Compliance", subfolder: "Environmental Condition Records" },
  { department: "Shipping & Receiving", folder: "Incoming Inspection", subfolder: "Incoming Inspection Record" },
  { department: "Purchasing", folder: "Supplier Management", subfolder: "Supplier Qualification & Evaluation" },
  { department: "Purchasing", folder: "Compliance & Documentation", subfolder: "PO Quality Requirements" },
];

async function ensureAdditionalSubfolders(db: TenantDb, tenantId: number, all: (typeof documentFolders.$inferSelect)[]): Promise<(typeof documentFolders.$inferSelect)[]> {
  let list = all;
  for (const { department, folder, subfolder } of ADDITIONAL_SUBFOLDERS) {
    const dept = list.find((f) => f.parentId === null && f.name === department);
    if (!dept) continue; // tenant doesn't have this department branch (e.g. a customized tree) — skip rather than force it back in
    const parentFolder = list.find((f) => f.parentId === dept.id && f.name === folder);
    if (!parentFolder) continue;
    if (list.some((f) => f.parentId === parentFolder.id && f.name === subfolder)) continue;
    const siblingCount = list.filter((f) => f.parentId === parentFolder.id).length;
    const [created] = await db.insert(documentFolders).values({ tenantId, name: subfolder, parentId: parentFolder.id, sortOrder: siblingCount }).returning();
    if (created) list = [...list, created];
  }
  return list;
}

/**
 * Self-heals `linkedPath` onto any leaf (no children) whose name matches a
 * known QMS module and doesn't already have one — same self-healing pattern
 * as ensureLibraryPool, so it applies to every tenant (existing or new)
 * without a one-off migration script. Skips anything naming a *procedure*
 * (a reference document about the process, not the live record type).
 */
async function linkKnownForms(db: TenantDb, tenantId: number, all: (typeof documentFolders.$inferSelect)[]): Promise<void> {
  const hasChildren = new Set(all.map((f) => f.parentId).filter((id): id is number => id !== null));
  const toLink = all.filter((f) => !hasChildren.has(f.id) && !f.linkedPath && !/procedure/i.test(f.name));

  for (const leaf of toLink) {
    const rule = FORM_LINK_RULES.find((r) => r.pattern.test(leaf.name));
    if (!rule) continue;
    await db.update(documentFolders).set({ linkedPath: rule.path }).where(and(eq(documentFolders.id, leaf.id), eq(documentFolders.tenantId, tenantId)));
    leaf.linkedPath = rule.path; // keep the in-memory list the caller returns consistent with what we just wrote
  }
}

/**
 * Adds `documentStatus`/`documentExpirationStatus` to any leaf carrying a
 * `documentId` — one batch query for the whole tree rather than N+1 — so the
 * Folder Explorer can show "Draft" / "Expiring Soon" / "Expired" without a
 * per-leaf round trip. Leaves without a linked document are untouched.
 */
async function withLinkedDocumentInfo(db: TenantDb, tenantId: number, all: (typeof documentFolders.$inferSelect)[]) {
  const documentIds = [...new Set(all.map((f) => f.documentId).filter((id): id is number => id !== null))];
  if (documentIds.length === 0) return all;

  const linked = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), inArray(documents.id, documentIds)));
  const byId = new Map(linked.map((d) => [d.id, d]));

  return all.map((f) => {
    if (f.documentId === null) return f;
    const doc = byId.get(f.documentId);
    if (!doc) return f;
    return { ...f, documentStatus: doc.status, documentExpirationStatus: expirationStatus(doc) };
  });
}

/** Full flat folder list for the tenant, seeding the default department tree on first use. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;

  const existing = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
  if (existing.length === 0) {
    await seedDefaults(db, tenantId);
    const seeded = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
    const pool = await ensureLibraryPool(db, tenantId, seeded.filter((f) => f.parentId === null));
    const all = await ensureAdditionalSubfolders(db, tenantId, [...seeded, pool]);
    await linkKnownForms(db, tenantId, all);
    return res.json(await withLinkedDocumentInfo(db, tenantId, all));
  }

  const pool = await ensureLibraryPool(db, tenantId, existing.filter((f) => f.parentId === null));
  const alreadyIncluded = existing.some((f) => f.id === pool.id);
  const withPool = alreadyIncluded ? existing : [...existing, pool];
  const all = await ensureAdditionalSubfolders(db, tenantId, withPool);
  await linkKnownForms(db, tenantId, all);
  res.json(await withLinkedDocumentInfo(db, tenantId, all));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const { name, parentId } = req.body as { name: string; parentId?: number };

  if (parentId !== undefined) {
    const [parent] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, parentId), eq(documentFolders.tenantId, tenantId)));
    if (!parent) throw AppError.notFound("Parent folder");
  }

  const siblings = await db
    .select()
    .from(documentFolders)
    .where(and(eq(documentFolders.tenantId, tenantId), parentId === undefined ? isNull(documentFolders.parentId) : eq(documentFolders.parentId, parentId)));

  const [created] = await db
    .insert(documentFolders)
    .values({ tenantId, name, parentId, sortOrder: siblings.length })
    .returning();
  if (!created) throw new AppError("Failed to create document folder", 500);

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: created.id,
    action: "create",
    changes: { name, parentId },
    performedBy: req.user?.id,
  });

  res.status(201).json(created);
});

/** Would setting `candidateParentId` as this folder's parent make it its own ancestor? */
async function wouldCreateCycle(db: TenantDb, tenantId: number, folderId: number, candidateParentId: number): Promise<boolean> {
  let cursor: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return false; // defensive: shouldn't happen in a well-formed tree
    seen.add(cursor);
    const [row] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, cursor), eq(documentFolders.tenantId, tenantId)));
    cursor = row?.parentId ?? null;
  }
  return false;
}

export const update = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { name, parentId, sortOrder, documentId } = req.body as {
    name?: string;
    parentId?: number | null;
    sortOrder?: number;
    documentId?: number | null;
  };

  const [current] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Document folder");

  if (parentId !== undefined && parentId !== null) {
    if (parentId === id) throw AppError.badRequest("A folder cannot be its own parent");
    const [parent] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, parentId), eq(documentFolders.tenantId, tenantId)));
    if (!parent) throw AppError.notFound("Parent folder");
    if (await wouldCreateCycle(db, tenantId, id, parentId)) {
      throw AppError.badRequest("That move would nest a folder inside itself");
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (parentId !== undefined) patch.parentId = parentId;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  if (documentId !== undefined) patch.documentId = documentId;

  const [updated] = await db
    .update(documentFolders)
    .set(patch)
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  if (!updated) throw AppError.notFound("Document folder");

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: id,
    action: "update",
    changes: { name, parentId, sortOrder, documentId },
    performedBy: req.user?.id,
  });

  res.json(updated);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const children = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, id), eq(documentFolders.tenantId, tenantId)));
  if (children.length > 0) {
    throw AppError.badRequest("Move or delete this folder's contents before deleting it");
  }

  const [deleted] = await db
    .delete(documentFolders)
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  if (!deleted) throw AppError.notFound("Document folder");

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: id,
    action: "delete",
    changes: { name: deleted.name },
    performedBy: req.user?.id,
  });

  res.status(204).send();
});

/**
 * Attach a user-uploaded PDF to a folder node ("use your own form instead of
 * — or in addition to — the supplied taxonomy"). Multer (memoryStorage, see
 * routes) has already validated size/mimetype and put the file on
 * `req.file`; this just persists it under the tenant's provisioned
 * `forms/custom` directory (same STORAGE_LOCAL_PATH convention the seeded
 * form templates use) and records the path on the folder row. Replacing an
 * existing attachment deletes the old file first.
 */
export const uploadTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${tenantId}/forms/custom`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${id}-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  if (folder.pdfPath && existsSync(folder.pdfPath)) {
    await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove replaced template file ${folder.pdfPath}`, err));
  }

  const [updated] = await db
    .update(documentFolders)
    .set({ pdfPath: path, updatedAt: new Date() })
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: id,
    action: "update",
    changes: { action: "upload_template", filename: file.originalname },
    performedBy: req.user?.id,
  });

  res.status(201).json(updated);
});

/** Streams the attached PDF back, e.g. for the "live preview" / download affordance. */
export const downloadTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");
  if (!folder.pdfPath || !existsSync(folder.pdfPath)) throw AppError.notFound("Attached template file");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${folder.name.replace(/[^\w.-]+/g, "_")}.pdf"`);
  createReadStream(folder.pdfPath).pipe(res);
});

/**
 * Detaches the PDF from a folder node — the node itself (and its place in the
 * tree) is untouched; only the attached file goes away. To send the whole
 * node back to the library pool instead, use PATCH .../:id { parentId }.
 */
export const removeTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");

  if (folder.pdfPath && existsSync(folder.pdfPath)) {
    await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove template file ${folder.pdfPath}`, err));
  }

  const [updated] = await db
    .update(documentFolders)
    .set({ pdfPath: null, updatedAt: new Date() })
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();

  await recordAuditTrail(db, {
    tenantId,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: id,
    action: "update",
    changes: { action: "remove_template" },
    performedBy: req.user?.id,
  });

  res.json(updated);
});
