import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { Db } from "../../lib/requestDb.js";
import { documents, documentVersions } from "../../drizzle/schema/documents.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { users } from "../../drizzle/schema/users.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";

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
  docs: Array<{ id: number; title: string; category: string | null; status: string; revisionCode: string | null; effectiveDate: Date | null; isDeleted: boolean }>,
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
      const approvalDate = day(latestRelease?.publishedAt ?? latestRelease?.reviewedAt ?? latestLedger?.approvedAt ?? (doc.status === "approved" ? doc.effectiveDate : null));
      const approvedBy = personName(people, latestRelease?.reviewedBy ?? latestLedger?.approvedBy ?? null);
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
      };
    })
    .sort((a, b) => a.id - b.id);
}

export const masterDocumentListHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listMasterDocuments(req.db!));
});

export async function listMasterDocuments(db: Db): Promise<MasterDocumentRow[]> {
  const docs = await db.select().from(documents);
  const versions = await db.select().from(documentVersions);
  const published = await db.select().from(controlledVersions).where(eq(controlledVersions.subjectType, "document"));
  const peopleRows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const folders = await db.select().from(documentFolders);
  const people = new Map(peopleRows.map((person) => [person.id, (person.name || person.email || "").trim()]));
  return buildMasterDocumentRows(
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
    folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId, documentId: folder.documentId })),
  );
}
