import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { ARCHIVED_READ_ONLY, isInObsoleteArchive } from "./obsoleteArchive.js";
import type { Db } from "../../lib/requestDb.js";
import { documents, documentVersions } from "../../drizzle/schema/documents.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { users } from "../../drizzle/schema/users.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { masterListOmissions } from "../../drizzle/schema/masterListOmissions.js";
import { PRINTED_FORM_ID_WHEN_BLANK, PRINTED_FORM_REVISION } from "../document-folders/formFiling.js";
import { ensureFormTemplates } from "../document-folders/formTemplates.js";
import { canMaintainMasterList } from "../roles/roleHierarchy.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export interface MasterDocumentRow {
  id: number;
  documentId: string;
  title: string;
  currentRev: string;
  approvalDate: string | null;
  approvedBy: string;
  location: string;
  status: string;
  revHistory: string;
  /** Where the title opens. Controlled documents stay on /documents/:id. */
  href: string;
}

/** A blank form already registered in document control. */
export interface RegisteredFormSource {
  id: number;
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  folderId: number | null;
  registerApprovalDate?: string | null;
  registerApprovedBy?: string | null;
}

/**
 * Null keeps the value already on the record. A saved string replaces it.
 * A blank string stays blank — nothing is filled in from the signed-in user.
 */
export function registerText(saved: string | null | undefined, derived: string | null): string | null {
  if (saved == null) return derived;
  const trimmed = saved.trim();
  return trimmed.length ? trimmed : null;
}

interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  documentId: number | null;
}

interface VersionNote {
  documentId: number;
  version: number;
  changeNotes: string | null;
  approvalNotes: string | null;
  approvedAt: Date | null;
  approvedBy: number | null;
}

interface PublishedNote {
  subjectId: number;
  versionNumber: number;
  status: string;
  revisionCode: string;
  summary: string;
  publishedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  obsolete: "Obsolete",
};

function day(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function personName(people: Map<number, string>, id: number | null | undefined): string {
  if (id == null) return "";
  return people.get(id) ?? "";
}

function folderPath(folder: FolderNode, byId: Map<number, FolderNode>): string {
  const names: string[] = [];
  const seen = new Set<number>();
  let current: FolderNode | undefined = folder;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return names.join(" / ");
}

function locationOf(docId: number, category: string | null, folders: FolderNode[], byId: Map<number, FolderNode>): string {
  const homes = folders.filter((folder) => folder.documentId === docId).map((folder) => folderPath(folder, byId));
  if (homes.length > 0) return homes.join("; ");
  if (!category) return "Document Control";
  return category
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** One live row per controlled document. Revisions, approvals, and folders come from the records already stored. */
export function buildMasterDocumentRows(
  docs: Array<{
    id: number;
    title: string;
    category: string | null;
    status: string;
    revisionCode: string | null;
    effectiveDate: Date | null;
    isDeleted: boolean;
    registerApprovalDate?: string | null;
    registerApprovedBy?: string | null;
  }>,
  versions: VersionNote[],
  published: PublishedNote[],
  people: Map<number, string>,
  folders: FolderNode[],
): MasterDocumentRow[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return docs
    .filter((doc) => !doc.isDeleted)
    .map((doc) => {
      const releases = published
        .filter((row) => row.subjectId === doc.id && (row.status === "published" || row.status === "archived"))
        .sort((a, b) => a.versionNumber - b.versionNumber);
      const ledger = versions.filter((row) => row.documentId === doc.id).sort((a, b) => a.version - b.version);
      const latestRelease = releases.at(-1) ?? null;
      const latestLedger = ledger.at(-1) ?? null;
      const derivedDate = day(latestRelease?.publishedAt ?? latestRelease?.reviewedAt ?? latestLedger?.approvedAt ?? (doc.status === "approved" ? doc.effectiveDate : null));
      const derivedBy = personName(people, latestRelease?.reviewedBy ?? latestLedger?.approvedBy ?? null);
      const approvalDate = registerText(doc.registerApprovalDate, derivedDate);
      const approvedBy = registerText(doc.registerApprovedBy, derivedBy) ?? "";
      const history = releases.length
        ? releases
            .map((row) => {
              const when = day(row.publishedAt ?? row.reviewedAt);
              const note = row.summary.trim();
              return [row.revisionCode || `Rev ${row.versionNumber}`, when, note].filter(Boolean).join(" ");
            })
            .join("; ")
        : ledger
            .map((row) => {
              const when = day(row.approvedAt);
              const note = (row.changeNotes || row.approvalNotes || "").trim();
              return [`Rev ${row.version}`, when, note].filter(Boolean).join(" ");
            })
            .join("; ");
      return {
        id: doc.id,
        documentId: `DOC-${doc.id}`,
        title: doc.title,
        currentRev: doc.revisionCode?.trim() || latestRelease?.revisionCode || "",
        approvalDate,
        approvedBy,
        location: locationOf(doc.id, doc.category, folders, byId),
        status: STATUS_LABEL[doc.status] ?? doc.status,
        revHistory: history,
        href: `/documents/${doc.id}`,
      };
    })
    .sort((a, b) => a.id - b.id);
}

function formIdentity(documentId: string, title: string): string {
  return `${documentId.trim().toUpperCase()}\n${title.trim().toUpperCase()}`;
}

/**
 * The number stored on the template. When that field is blank, the id printed
 * on the two master lists. A blank field with no printed id stays off the list.
 */
export function documentNumberForForm(formKey: string, formId: string): string {
  const stored = formId.trim();
  if (stored) return stored;
  return PRINTED_FORM_ID_WHEN_BLANK[formKey] ?? "";
}

/**
 * Adds each registered form that already has a number. A form already on the
 * list (same document id and title) is left as it is. Reading this again does
 * not add a second row. Template numbers are stored by the form-template sync.
 */
export function withRegisteredForms(documentRows: MasterDocumentRow[], templates: RegisteredFormSource[], folders: FolderNode[]): MasterDocumentRow[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const present = new Set(documentRows.map((row) => formIdentity(row.documentId, row.title)));
  const added: MasterDocumentRow[] = [];
  const ordered = [...templates].sort((a, b) => {
    const left = documentNumberForForm(a.formKey, a.formId);
    const right = documentNumberForForm(b.formKey, b.formId);
    return left.localeCompare(right) || a.title.localeCompare(b.title) || a.formKey.localeCompare(b.formKey);
  });
  for (const template of ordered) {
    const documentId = documentNumberForForm(template.formKey, template.formId);
    if (!documentId) continue;
    const key = formIdentity(documentId, template.title);
    if (present.has(key)) continue;
    present.add(key);
    const folder = template.folderId == null ? undefined : byId.get(template.folderId);
    added.push({
      id: -template.id,
      documentId,
      title: template.title,
      currentRev: PRINTED_FORM_REVISION[template.formKey] ?? "",
      approvalDate: registerText(template.registerApprovalDate, null),
      approvedBy: registerText(template.registerApprovedBy, "") ?? "",
      location: folder ? folderPath(folder, byId) : "Document Control",
      status: "Template",
      revHistory: "",
      href: template.subjectRoute,
    });
  }
  return [...documentRows, ...added];
}

const DOCUMENT_LIST_KEY = "documents";

/** Drops rows someone removed from the Master Document List. A template is matched by form key, a document by id. */
export function withoutOmittedMasterRows(
  rows: MasterDocumentRow[],
  hidden: { source: string; sourceKey: string }[],
  templates: { id: number; formKey: string }[],
): MasterDocumentRow[] {
  const documentsHidden = new Set(hidden.filter((row) => row.source === "document").map((row) => Number(row.sourceKey)));
  const formKeys = new Set(hidden.filter((row) => row.source === "template").map((row) => row.sourceKey));
  const templateIds = new Set(templates.filter((template) => formKeys.has(template.formKey)).map((template) => -template.id));
  return rows.filter((row) => !documentsHidden.has(row.id) && !templateIds.has(row.id));
}

export const masterDocumentListHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listMasterDocuments(req.db!));
});

/** Saves Approval Date and Approved By typed on the Master Document List. Does not invent either value. */
export const patchMasterListRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { id: number; approvalDate?: string | null; approvedBy?: string | null };
  if (body.approvalDate === undefined && body.approvedBy === undefined) {
    throw AppError.badRequest("Nothing to update");
  }
  const patch: { registerApprovalDate?: string | null; registerApprovedBy?: string | null } = {};
  if (body.approvalDate !== undefined) patch.registerApprovalDate = body.approvalDate;
  if (body.approvedBy !== undefined) patch.registerApprovedBy = body.approvedBy;

  if (body.id > 0) {
    const [existing] = await req.db!.select({ status: documents.status, category: documents.category }).from(documents).where(eq(documents.id, body.id));
    if (!existing) throw AppError.notFound("Document");
    if (isInObsoleteArchive(existing)) throw new AppError(ARCHIVED_READ_ONLY, 409);
    const [updated] = await req
      .db!.update(documents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(documents.id, body.id))
      .returning({ id: documents.id });
    if (!updated) throw AppError.notFound("Document");
  } else {
    const [updated] = await req
      .db!.update(controlledFormTemplates)
      .set(patch)
      .where(eq(controlledFormTemplates.id, -body.id))
      .returning({ id: controlledFormTemplates.id });
    if (!updated) throw AppError.notFound("Form");
  }

  const rows = await listMasterDocuments(req.db!);
  res.json(rows.find((item) => item.id === body.id) ?? { id: body.id });
});

const MASTER_LIST_FORBIDDEN = "Editing a master list is limited to Engineering, Quality Manager, VP of Engineering and Quality, and Administrator.";

/** Takes one row off the Master Document List. The document or blank form stays. */
export const omitMasterListRowHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!canMaintainMasterList(req.user)) throw AppError.forbidden(MASTER_LIST_FORBIDDEN);
  const id = (req.body as { id: number }).id;
  const db = req.db!;
  await ensureFormTemplates(db);
  const templates = await db.select().from(controlledFormTemplates);
  const visible = await listMasterDocuments(db);
  const row = visible.find((item) => item.id === id);
  if (!row) throw AppError.notFound("That row is not on the Master Document List");

  const omissions: { source: string; sourceKey: string }[] = [];
  if (id > 0) {
    omissions.push({ source: "document", sourceKey: String(id) });
    const identity = formIdentity(row.documentId, row.title);
    for (const template of templates) {
      const number = documentNumberForForm(template.formKey, template.formId);
      if (number && formIdentity(number, template.title) === identity) {
        omissions.push({ source: "template", sourceKey: template.formKey });
      }
    }
  } else {
    const template = templates.find((item) => item.id === -id);
    if (!template) throw AppError.notFound("Form");
    omissions.push({ source: "template", sourceKey: template.formKey });
  }

  for (const omission of omissions) {
    await db
      .insert(masterListOmissions)
      .values({ listKey: DOCUMENT_LIST_KEY, source: omission.source, sourceKey: omission.sourceKey, createdBy: req.user?.id })
      .onConflictDoNothing({ target: [masterListOmissions.listKey, masterListOmissions.source, masterListOmissions.sourceKey] });
  }
  await recordAuditTrail(db, {
    entityType: id > 0 ? "Document" : "ControlledFormTemplate",
    entityId: Math.abs(id),
    action: "delete",
    performedBy: req.user?.id,
    changes: { event: "omit_master_document_row", documentId: row.documentId, title: row.title, omissions },
  });
  res.status(204).send();
});

export async function listMasterDocuments(db: Db): Promise<MasterDocumentRow[]> {
  await ensureFormTemplates(db);
  const docs = await db.select().from(documents);
  const versions = await db.select().from(documentVersions);
  const published = await db.select().from(controlledVersions).where(eq(controlledVersions.subjectType, "document"));
  const peopleRows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const folders = await db.select().from(documentFolders);
  const templates = await db.select().from(controlledFormTemplates);
  const omissions = await db.select().from(masterListOmissions).where(eq(masterListOmissions.listKey, DOCUMENT_LIST_KEY));
  const hiddenDocuments = new Set(
    omissions.filter((row) => row.source === "document").map((row) => Number(row.sourceKey)).filter((rowId) => Number.isInteger(rowId)),
  );
  const hiddenFormKeys = new Set(omissions.filter((row) => row.source === "template").map((row) => row.sourceKey));
  const people = new Map(peopleRows.map((person) => [person.id, (person.name || person.email || "").trim()]));
  const folderNodes = folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId, documentId: folder.documentId }));
  const rows = buildMasterDocumentRows(
    docs,
    versions.map((row) => ({
      documentId: row.documentId,
      version: row.version,
      changeNotes: row.changeNotes,
      approvalNotes: row.approvalNotes,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
    })),
    published.map((row) => {
      const payload = row.payload ?? {};
      const meta = row.metadata ?? {};
      const revision = typeof payload.revisionCode === "string" ? payload.revisionCode : "";
      const summary = typeof meta.summary === "string" ? meta.summary : typeof row.reviewNotes === "string" ? row.reviewNotes : "";
      return {
        subjectId: row.subjectId,
        versionNumber: row.versionNumber,
        status: row.status,
        revisionCode: revision,
        summary,
        publishedAt: row.publishedAt,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewedBy,
      };
    }),
    people,
    folderNodes,
  );
  return withoutOmittedMasterRows(
    withRegisteredForms(
      rows.filter((row) => !hiddenDocuments.has(row.id)),
      templates
        .filter((template) => !hiddenFormKeys.has(template.formKey))
        .map((template) => ({
          id: template.id,
          formKey: template.formKey,
          formId: template.formId,
          title: template.title,
          subjectRoute: template.subjectRoute,
          folderId: template.folderId,
          registerApprovalDate: template.registerApprovalDate,
          registerApprovedBy: template.registerApprovedBy,
        })),
      folderNodes,
    ),
    omissions,
    templates,
  );
}
