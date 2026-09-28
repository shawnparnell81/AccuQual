import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { dataImports } from "../../drizzle/schema/dataImports.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyRecipients } from "../notifications/notification.service.js";
import { logger } from "../../utils/logger.js";
import type { AnyImportEntity, ImportContext } from "./import.entities.js";
import { getCatalogEntry, rawFromMapping, rowIdentity } from "./import.catalog.js";
import { classifyImportRow, type BadRowMode, type DuplicateMode } from "./import.classify.js";
import { scanSpreadsheet, type ScannedRow } from "./import.scan.js";

export const SYNC_ROW_LIMIT = 1500;
const CHUNK = 100;
const PROBLEM_LIMIT = 100;

export interface ImportRunOptions {
  mapping: Record<string, number | null>;
  badRowMode: BadRowMode;
  duplicateMode: DuplicateMode;
  sendInvites: boolean;
  /** When false, rows are checked and nothing is saved. */
  commit: boolean;
}

interface Problem {
  row: number;
  label: string;
  messages: string[];
}

const running = new Set<number>();

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function loadJob(id: number) {
  const [row] = await db.select().from(dataImports).where(eq(dataImports.id, id));
  return row;
}

export async function failInterruptedImports(): Promise<void> {
  await db
    .update(dataImports)
    .set({ status: "failed", message: "Stopped before it finished. Upload the file again if you still need it.", completedAt: new Date() })
    .where(inArray(dataImports.status, ["running", "checking"]));
}

export function scheduleImport(id: number): void {
  setImmediate(() => {
    void executeImport(id);
  });
}

export async function executeImport(id: number): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    await runStoredImport(id);
  } finally {
    running.delete(id);
  }
}

async function runStoredImport(id: number): Promise<void> {
  const job = await loadJob(id);
  if (!job) return;
  const entry = getCatalogEntry(job.entityKey);
  if (!entry) {
    await db.update(dataImports).set({ status: "failed", message: "That kind of data can't be imported.", completedAt: new Date() }).where(eq(dataImports.id, id));
    return;
  }
  const options: ImportRunOptions = {
    mapping: job.mapping ?? {},
    badRowMode: job.badRowMode === "fail" ? "fail" : "skip",
    duplicateMode: job.duplicateMode === "update" || job.duplicateMode === "create_only" ? job.duplicateMode : "skip",
    sendInvites: job.sendInvites,
    commit: job.status !== "checking",
  };
  try {
    await processFile(id, job.filePath, job.fileName, entry.key, entry.entity, options, job.startedBy ?? undefined, entry.supportsInvites === true);
  } catch (err) {
    logger.error("Import failed", { id, err });
    const message = err instanceof Error ? err.message : "The import stopped because of a problem reading the file.";
    await db.update(dataImports).set({ status: "failed", message, completedAt: new Date() }).where(eq(dataImports.id, id));
  }
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    stream.end();
  });
}

async function processFile(id: number, filePath: string, fileName: string, catalogKey: string, entity: AnyImportEntity, options: ImportRunOptions, userId: number | undefined, supportsInvites: boolean): Promise<void> {
  const identities: string[] = [];
  await scanSpreadsheet(filePath, fileName, async (row) => {
    const raw = rawFromMapping(entity, options.mapping, row.cells);
    const identity = rowIdentity(entity, raw);
    if (identity) identities.push(identity);
  });

  const ctx: ImportContext = { db, userId };
  const lookups = await entity.prepare(ctx, identities);
  const primary = entity.fields.find((field) => field.required)?.key ?? entity.fields[0]!.key;

  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, processed: 0 };
  const problems: Problem[] = [];
  const seen = new Map<string, number>();
  const reportDir = path.join(env.STORAGE_LOCAL_PATH, "imports");
  await mkdir(reportDir, { recursive: true });
  const errorReportPath = path.join(reportDir, `${id}-errors.csv`);
  const report = createWriteStream(errorReportPath);
  report.write("Row,Value,Problem\n");

  const noteProblem = (problem: Problem) => {
    counts.failed += 1;
    if (problems.length < PROBLEM_LIMIT) problems.push(problem);
    report.write(`${problem.row},${csvCell(problem.label)},${csvCell(problem.messages.join(" "))}\n`);
  };

  const pending: { number: number; label: string; identity: string; action: "create" | "update"; value: unknown }[] = [];

  const flush = async () => {
    if (!options.commit || pending.length === 0) {
      pending.length = 0;
      return;
    }
    const batch = pending.splice(0, pending.length);
    for (const item of batch) {
      try {
        await db.transaction(async (tx) => {
          const rowCtx: ImportContext = { db: tx as unknown as ImportContext["db"], userId };
          if (item.action === "update") {
            const existingId = lookups.ids.get(item.identity);
            if (existingId == null || !entity.update) throw new Error("missing");
            await entity.update(rowCtx, existingId, item.value, lookups);
          } else {
            const made = await entity.insert(rowCtx, item.value, lookups);
            if (options.sendInvites && supportsInvites && made.temporaryPassword) {
              await notifyRecipients(
                tx as unknown as ImportContext["db"],
                [made.label],
                "Your AccuQual sign-in",
                `An account was created for you. Sign in at ${env.FRONTEND_URL} with this temporary password, then choose your own:\n\n${made.temporaryPassword}\n\nThis password is only in this message.`
              );
            }
          }
        });
        if (item.action === "update") counts.updated += 1;
        else counts.created += 1;
      } catch (err) {
        logger.error("Import row failed to save", { id, row: item.number, err });
        noteProblem({ row: item.number, label: item.label, messages: ["Couldn't be saved. Check the values and try this row again."] });
      }
    }
  };

  const consider = async (row: ScannedRow) => {
    const raw = rawFromMapping(entity, options.mapping, row.cells);
    const result = entity.validate(raw, lookups);
    const label = (raw[primary] ?? "").trim() || "(blank)";
    const identity = result.identity || rowIdentity(entity, raw);
    const decision = classifyImportRow({
      rowNumber: row.number,
      label,
      identity: identity || undefined,
      fieldErrors: result.errors,
      existing: lookups.existing,
      seen,
      duplicateMode: options.duplicateMode,
    });
    counts.processed += 1;
    if (decision.action === "invalid") noteProblem({ row: row.number, label, messages: decision.messages });
    else if (decision.action === "skip") counts.skipped += 1;
    else if (!options.commit) {
      if (decision.action === "update") counts.updated += 1;
      else counts.created += 1;
    } else pending.push({ number: row.number, label, identity, action: decision.action, value: result.value });
    if (pending.length >= CHUNK) await flush();
    if (counts.processed % 200 === 0) {
      await db.update(dataImports).set({ processedRows: counts.processed, createdCount: counts.created, updatedCount: counts.updated, skippedCount: counts.skipped, failedCount: counts.failed }).where(eq(dataImports.id, id));
    }
  };

  if (options.badRowMode === "fail" && options.commit) {
    let failed = 0;
    await scanSpreadsheet(filePath, fileName, async (row) => {
      const raw = rawFromMapping(entity, options.mapping, row.cells);
      const result = entity.validate(raw, lookups);
      const label = (raw[primary] ?? "").trim() || "(blank)";
      const identity = result.identity || rowIdentity(entity, raw);
      const decision = classifyImportRow({
        rowNumber: row.number,
        label,
        identity: identity || undefined,
        fieldErrors: result.errors,
        existing: lookups.existing,
        seen,
        duplicateMode: options.duplicateMode,
      });
      if (decision.action === "invalid") {
        failed += 1;
        noteProblem({ row: row.number, label, messages: decision.messages });
      } else if (decision.action === "skip") counts.skipped += 1;
    });
    if (failed > 0) {
      await endStream(report);
      const message = "Nothing was imported because some rows had problems. Fix them, or choose to skip bad rows, and try again.";
      await finished(id, counts, problems, errorReportPath, true, message);
      await recordAuditTrail(db, { entityType: "DataImport", entityId: id, action: "create", changes: { fileName, entity: catalogKey, created: 0, updated: 0, skipped: counts.skipped, failed: counts.failed, outcome: "rejected" }, performedBy: userId });
      return;
    }
    seen.clear();
    counts.skipped = 0;
  }

  await scanSpreadsheet(filePath, fileName, consider);
  await flush();
  await endStream(report);
  const message = options.commit
    ? `Created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped}, failed ${counts.failed}.`
    : `${counts.created} would be added, ${counts.updated} updated, ${counts.skipped} skipped, ${counts.failed} have problems. Nothing has been saved yet.`;
  await finished(id, counts, problems, errorReportPath, options.commit, message);
  if (options.commit) {
    await recordAuditTrail(db, {
      entityType: "DataImport",
      entityId: id,
      action: "create",
      changes: { fileName, entity: catalogKey, created: counts.created, updated: counts.updated, skipped: counts.skipped, failed: counts.failed },
      performedBy: userId,
    });
  }
}

async function finished(id: number, counts: { created: number; updated: number; skipped: number; failed: number; processed: number }, problems: Problem[], errorReportPath: string, commit: boolean, message: string) {
  await db
    .update(dataImports)
    .set({
      status: commit ? "completed" : "checked",
      processedRows: counts.processed,
      createdCount: counts.created,
      updatedCount: counts.updated,
      skippedCount: counts.skipped,
      failedCount: counts.failed,
      problems,
      errorReportPath: counts.failed > 0 ? errorReportPath : null,
      message,
      completedAt: commit ? new Date() : null,
    })
    .where(eq(dataImports.id, id));
}

