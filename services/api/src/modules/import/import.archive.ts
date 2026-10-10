import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { dataImports } from "../../drizzle/schema/dataImports.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { optionalRows } from "../sites/optionalSql.js";
import { AppError } from "../../utils/appError.js";
import { getCatalogEntry } from "./import.catalog.js";
import { headerMapFromIndexes, sumMappedField } from "./import.mapping.js";
import { retailerFieldLabel } from "./import.retailer.js";
import { scanSpreadsheet } from "./import.scan.js";

export const IMPORT_PULL_SECTIONS = ["returns", "warranty", "labor", "financials"] as const;
export type ImportPullSection = (typeof IMPORT_PULL_SECTIONS)[number];

export interface ImportPull {
  importId: number;
  section: ImportPullSection;
  field: string;
}

export interface ImportSourceRows {
  importId: number;
  displayName: string;
  typeLabel: string;
  rows: { mapped: Record<string, string> }[];
}

export interface ImportedDatasetLine {
  importId: number;
  section: ImportPullSection;
  field: string;
  fieldLabel: string;
  total: number | null;
  source: string;
  missing: boolean;
}

export interface PendingImportSave {
  displayName: string;
  folderId: number;
  userId: number | undefined;
  siteId: number | null;
}

const pendingSaves = new Map<number, PendingImportSave>();

const ISO_ROOT = "ISO Compliance Documents";
const REPORTS_FOLDER = "Reports";
const IMPORTED_FOLDER = "Imported Data";

export const IMPORT_ARCHIVE_UNAVAILABLE = "Imported Data isn't available until the database update runs.";

export function rememberImportSave(id: number, save: PendingImportSave): void {
  pendingSaves.set(id, save);
}

export function dropImportSave(id: number): void {
  pendingSaves.delete(id);
}

export async function importArchiveReady(database: Db): Promise<boolean> {
  const rows = await optionalRows<{ ok: number }>(database, sql`SELECT 1 AS ok FROM import_saves LIMIT 0`);
  return rows != null;
}

export async function loadHeaderMap(database: Db, entityKey: string): Promise<Record<string, string | null> | null> {
  const rows = await optionalRows<{ header_map: Record<string, string | null> | null }>(
    database,
    sql`SELECT header_map FROM import_column_maps WHERE entity_key = ${entityKey} LIMIT 1`,
  );
  if (rows == null || rows.length === 0) return null;
  const map = rows[0]?.header_map;
  return map && typeof map === "object" ? map : null;
}

export async function saveHeaderMap(
  database: Db,
  entityKey: string,
  headers: string[],
  mapping: Record<string, number | null>,
  fields: { key: string }[],
  userId: number | undefined,
): Promise<void> {
  if (!(await importArchiveReady(database))) return;
  const headerMap = headerMapFromIndexes(fields, headers, mapping);
  await database.execute(sql`
    INSERT INTO import_column_maps (entity_key, header_map, updated_by, updated_at)
    VALUES (${entityKey}, CAST(${JSON.stringify(headerMap)} AS jsonb), ${userId ?? null}, now())
    ON CONFLICT (entity_key) DO UPDATE
      SET header_map = EXCLUDED.header_map, updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
}

export async function ensureImportedDataFolder(database: Db): Promise<{ id: number; label: string }> {
  const all = await database.select({ id: documentFolders.id, name: documentFolders.name, parentId: documentFolders.parentId }).from(documentFolders);
  const iso = all.find((folder) => folder.parentId == null && folder.name === ISO_ROOT);
  let reports = all.find((folder) => folder.name === REPORTS_FOLDER && folder.parentId === (iso?.id ?? null));
  if (!reports && iso) reports = all.find((folder) => folder.name === REPORTS_FOLDER && folder.parentId === iso.id);
  if (!reports) {
    const [created] = await database.insert(documentFolders).values({ name: REPORTS_FOLDER, parentId: iso?.id ?? null, sortOrder: 80 }).returning();
    reports = created!;
  }
  let imported = all.find((folder) => folder.name === IMPORTED_FOLDER && folder.parentId === reports.id);
  if (!imported) {
    const [created] = await database.insert(documentFolders).values({ name: IMPORTED_FOLDER, parentId: reports.id, sortOrder: 0 }).returning();
    imported = created!;
  }
  return { id: imported.id, label: `${REPORTS_FOLDER} / ${IMPORTED_FOLDER}` };
}

async function folderLabel(database: Db, folderId: number): Promise<string> {
  const all = await database.select({ id: documentFolders.id, name: documentFolders.name, parentId: documentFolders.parentId }).from(documentFolders);
  const names: string[] = [];
  let current = all.find((folder) => folder.id === folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : all.find((folder) => folder.id === current!.parentId);
  }
  return names.join(" / ") || "Folder";
}

async function storeParsedRows(database: Db, importId: number, filePath: string, fileName: string, mapping: Record<string, number | null>, fields: { key: string }[]): Promise<number> {
  await database.execute(sql`DELETE FROM import_parsed_rows WHERE import_id = ${importId}`);
  let stored = 0;
  const chunk: { number: number; cells: string[]; mapped: Record<string, string> }[] = [];
  const flush = async () => {
    if (chunk.length === 0) return;
    const batch = chunk.splice(0, chunk.length);
    for (const row of batch) {
      await database.execute(sql`
        INSERT INTO import_parsed_rows (import_id, row_number, cells, mapped)
        VALUES (${importId}, ${row.number}, CAST(${JSON.stringify(row.cells)} AS jsonb), CAST(${JSON.stringify(row.mapped)} AS jsonb))
      `);
      stored += 1;
    }
  };
  await scanSpreadsheet(filePath, fileName, async (row) => {
    const mapped: Record<string, string> = {};
    for (const field of fields) {
      const column = mapping[field.key];
      mapped[field.key] = column == null ? "" : (row.cells[column] ?? "");
    }
    chunk.push({ number: row.number, cells: row.cells, mapped });
    if (chunk.length >= 80) await flush();
  });
  await flush();
  return stored;
}

export async function commitImportSave(database: Db, importId: number): Promise<{ archived: boolean }> {
  const pending = pendingSaves.get(importId);
  pendingSaves.delete(importId);
  if (!pending) return { archived: false };
  const [job] = await database.select().from(dataImports).where(eq(dataImports.id, importId));
  if (!job || job.status !== "completed") return { archived: false };
  const entry = getCatalogEntry(job.entityKey);
  const typeLabel = entry?.label ?? job.entityKey;
  const place = await folderLabel(database, pending.folderId);
  const ready = await importArchiveReady(database);
  let rowCount = job.totalRows;
  if (ready && entry) {
    rowCount = await storeParsedRows(database, importId, job.filePath, job.fileName, job.mapping ?? {}, entry.entity.fields);
    const [node] = await database
      .insert(documentFolders)
      .values({
        name: pending.displayName,
        parentId: pending.folderId,
        sortOrder: 0,
        pdfPath: job.filePath,
        pdfMimeType: job.mimeType,
        linkedPath: `/reporting/imported-data/${importId}`,
      })
      .returning();
    await database.execute(sql`
      INSERT INTO import_saves (
        import_id, display_name, folder_id, folder_node_id, site_id, saved_by, row_count, source_file_name, entity_key, created_at
      ) VALUES (
        ${importId}, ${pending.displayName}, ${pending.folderId}, ${node?.id ?? null}, ${pending.siteId},
        ${pending.userId ?? null}, ${rowCount}, ${job.fileName}, ${job.entityKey}, now()
      )
      ON CONFLICT (import_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        folder_id = EXCLUDED.folder_id,
        folder_node_id = EXCLUDED.folder_node_id,
        site_id = EXCLUDED.site_id,
        saved_by = EXCLUDED.saved_by,
        row_count = EXCLUDED.row_count,
        source_file_name = EXCLUDED.source_file_name,
        entity_key = EXCLUDED.entity_key
    `);
  }
  await recordAuditTrail(database, {
    entityType: "DataImport",
    entityId: importId,
    action: "create",
    changes: {
      event: "imported",
      fileName: job.fileName,
      displayName: pending.displayName,
      type: typeLabel,
      rowCount,
      importedAt: new Date().toISOString(),
      folder: place,
    },
    performedBy: pending.userId,
  });
  return { archived: ready };
}

export async function assertFolderExists(database: Db, folderId: number): Promise<void> {
  const [folder] = await database.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!folder) throw AppError.badRequest("Choose a folder to save this import in.");
}

export function sectionLabel(section: ImportPullSection): string {
  if (section === "returns") return "Returns";
  if (section === "warranty") return "Warranty";
  if (section === "labor") return "Labor";
  return "Financials";
}

export function resolveImportPulls(pulls: ImportPull[], sources: ImportSourceRows[]): ImportedDatasetLine[] {
  const byId = new Map(sources.map((source) => [source.importId, source]));
  return pulls.map((pull) => {
    const source = byId.get(pull.importId);
    const fieldLabel = retailerFieldLabel(pull.field);
    if (!source) {
      return { importId: pull.importId, section: pull.section, field: pull.field, fieldLabel, total: null, source: "Import not available", missing: true };
    }
    return {
      importId: pull.importId,
      section: pull.section,
      field: pull.field,
      fieldLabel,
      total: sumMappedField(source.rows, pull.field),
      source: `${source.displayName} · ${source.typeLabel}`,
      missing: false,
    };
  });
}

export async function loadImportSources(database: Db, pulls: ImportPull[], plantId: number | null): Promise<{ available: boolean; sources: ImportSourceRows[] }> {
  if (pulls.length === 0) return { available: true, sources: [] };
  if (!(await importArchiveReady(database))) return { available: false, sources: [] };
  const ids = [...new Set(pulls.map((pull) => pull.importId))];
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const plant = plantId == null ? sql`true` : sql`(s.site_id = ${plantId} OR s.site_id IS NULL)`;
  const saves = await optionalRows<{ import_id: number; display_name: string; entity_key: string }>(
    database,
    sql`SELECT s.import_id, s.display_name, s.entity_key FROM import_saves s WHERE s.deleted_at IS NULL AND s.import_id IN (${idList}) AND ${plant}`,
  );
  if (saves == null) return { available: false, sources: [] };
  const sources: ImportSourceRows[] = [];
  for (const save of saves) {
    const parsed = await optionalRows<{ mapped: Record<string, string> }>(
      database,
      sql`SELECT mapped FROM import_parsed_rows WHERE import_id = ${save.import_id} ORDER BY row_number`,
    );
    const entry = getCatalogEntry(save.entity_key);
    sources.push({
      importId: save.import_id,
      displayName: save.display_name,
      typeLabel: entry?.label ?? save.entity_key,
      rows: (parsed ?? []).map((row) => ({ mapped: row.mapped ?? {} })),
    });
  }
  return { available: true, sources };
}

export async function removeFiledNode(database: Db, nodeId: number | null): Promise<void> {
  if (nodeId == null) return;
  const [node] = await database.select({ id: documentFolders.id }).from(documentFolders).where(and(eq(documentFolders.id, nodeId), isNull(documentFolders.documentId)));
  if (!node) return;
  const [child] = await database.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, nodeId)).limit(1);
  if (child) return;
  await database.delete(documentFolders).where(eq(documentFolders.id, nodeId));
}
