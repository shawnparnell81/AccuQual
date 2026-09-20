import archiver, { type Archiver } from "archiver";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { PoolClient } from "pg";
import { pool } from "../../db/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { buildPlan, scrubJson, type ExportPlan, type TablePlan } from "./exportPlan.js";

export type ExportFormat = "json" | "csv";

export interface ExportOptions {
  format: ExportFormat;
  includeFiles: boolean;
  /** Per-table safety cap. A table over it is written truncated, and the manifest says so. */
  rowCap?: number;
  /** Total uploaded-file bytes to include; anything beyond is listed as skipped. */
  maxFileBytes?: number;
  /** A single file over this is skipped. */
  maxSingleFileBytes?: number;
}

export interface ExportActor {
  tenantId: number;
  userId: number;
  email: string;
}

const BATCH = 1000;
export const DEFAULT_ROW_CAP = 250_000;
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024;

/**
 * One consistent, read-only, tenant-scoped snapshot. `REPEATABLE READ` means every table is read as of the same
 * instant (an export taken while people are working is still internally consistent), and the switch into the
 * restricted `accuqual_app` role means Postgres row-level security — not just our WHERE clause — keeps every row to
 * this tenant. Uses its own connection because the request-scoped one (lib/tenantScope.ts) commits on res.json/send,
 * which a streamed download never calls.
 */
async function withSnapshot<T>(tenantId: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL ROLE accuqual_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

// ---- Describe ---------------------------------------------------------------------------------------------------------------------------------

export interface ExportDescription {
  tables: { table: string; rows: number; omittedColumns: string[] }[];
  excluded: { table: string; reason: string }[];
  totalRows: number;
}

/** What an export would contain right now, with row counts — shown to the administrator before they ask for one. */
export async function describeExport(tenantId: number): Promise<ExportDescription> {
  return withSnapshot(tenantId, async (client) => {
    const plan = await buildPlan(client);
    const tables: ExportDescription["tables"] = [];
    for (const t of plan.tables) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${q(t.table)} WHERE ${q(t.scopeColumn)} = $1`, [tenantId]);
      tables.push({ table: t.table, rows: Number(rows[0]?.n ?? 0), omittedColumns: t.omittedColumns });
    }
    return { tables, excluded: plan.excluded, totalRows: tables.reduce((s, t) => s + t.rows, 0) };
  });
}

// ---- Serialisation ---------------------------------------------------------------------------------------------------------------------------

function cell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") return scrubJson(value);
  return value;
}

function csvField(value: unknown): string {
  const v = cell(value);
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Cells starting with these are read as formulas by spreadsheet programs; prefix so a stored value can't execute when opened.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function* readTable(client: PoolClient, plan: TablePlan, tenantId: number, cap: number): AsyncGenerator<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const cols = plan.columns.map(q).join(", ");
  let sent = 0;
  if (!plan.hasId) {
    const { rows } = await client.query(`SELECT ${cols} FROM ${q(plan.table)} WHERE ${q(plan.scopeColumn)} = $1 LIMIT ${cap + 1}`, [tenantId]);
    yield { rows: rows.slice(0, cap), truncated: rows.length > cap };
    return;
  }
  let after = 0;
  for (;;) {
    const limit = Math.min(BATCH, cap - sent + 1);
    const { rows } = await client.query(`SELECT ${cols} FROM ${q(plan.table)} WHERE ${q(plan.scopeColumn)} = $1 AND id > $2 ORDER BY id LIMIT ${limit}`, [tenantId, after]);
    if (rows.length === 0) return;
    const overCap = sent + rows.length > cap;
    const usable = overCap ? rows.slice(0, cap - sent) : rows;
    sent += usable.length;
    yield { rows: usable, truncated: overCap };
    if (overCap) return;
    after = Number(rows[rows.length - 1]!.id);
    if (rows.length < limit) return;
  }
}

/** Appends one archive entry produced incrementally, and resolves when the archive has finished writing it. */
function appendStreamed(archive: Archiver, name: string, produce: (out: PassThrough) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const onEntry = (entry: { name: string }) => {
      if (entry.name !== name) return;
      archive.off("entry", onEntry);
      resolve();
    };
    archive.on("entry", onEntry);
    archive.append(out, { name });
    produce(out)
      .then(() => out.end())
      .catch((err) => {
        out.destroy(err as Error);
        reject(err);
      });
  });
}

const write = (out: PassThrough, chunk: string): Promise<void> => (out.write(chunk) ? Promise.resolve() : new Promise((r) => out.once("drain", () => r())));

// ---- Files ------------------------------------------------------------------------------------------------------------------------------------

/** The only place uploaded files may be read from for this tenant. */
export function tenantStorageRoot(tenantId: number): string {
  return path.resolve(env.STORAGE_LOCAL_PATH, "tenants", String(tenantId));
}

/** Resolves a stored file path and refuses anything that is not inside the tenant's own folder (relative paths, `..`, other tenants' folders, absolute system paths). */
export function resolveTenantFile(tenantId: number, stored: string): string | null {
  const root = tenantStorageRoot(tenantId);
  const resolved = path.isAbsolute(stored) ? path.resolve(stored) : path.resolve(env.STORAGE_LOCAL_PATH, stored.replace(/^\/+/, ""));
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

// ---- The export --------------------------------------------------------------------------------------------------------------------------------

export interface ExportManifest {
  exportedAt: string;
  format: ExportFormat;
  tenant: { id: number; name: string | null; code: string | null };
  exportedBy: { id: number; email: string };
  appVersion: string;
  includeFiles: boolean;
  tables: { name: string; file: string; rows: number; truncated: boolean; omittedColumns: string[] }[];
  excludedTables: { table: string; reason: string }[];
  files: { included: number; bytes: number; skipped: { path: string; reason: string }[] };
  totalRows: number;
}

const README = (m: { tenantName: string; format: ExportFormat; includeFiles: boolean }) => `AccuQual data export — ${m.tenantName}
${"=".repeat(60)}

This archive holds the records your organization keeps in AccuQual.

  manifest.json   what is in here: every table with its row count, anything left out and why
  data/           one ${m.format === "json" ? "JSON Lines (.jsonl — one record per line)" : "CSV (.csv)"} file per table
${m.includeFiles ? "  files/          uploaded documents and certificates, grouped by the table they belong to\n" : ""}
Notes
- Dates are UTC, in ISO 8601 form.
- Nested values (for example the contents of a form) are stored as JSON — as JSON in the ${m.format === "json" ? ".jsonl files" : "CSV cells"}.
- Records reference each other by id (for example ncr.supplier_id refers to suppliers.id).
- Credentials are never exported: password hashes, two-step sign-in secrets, API keys, tokens and similar values
  are withheld, and manifest.json lists each withheld column by name.
- Records are exactly as they were at the instant the export started.
`;

/**
 * Writes the export into `archive` (which the caller has piped to the response). Streams table by table so memory
 * stays flat however large the tenant is. Returns the manifest (also written into the archive as manifest.json).
 */
export async function writeTenantExport(archive: Archiver, actor: ExportActor, opts: ExportOptions): Promise<ExportManifest> {
  const rowCap = opts.rowCap ?? DEFAULT_ROW_CAP;
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxSingleFileBytes = opts.maxSingleFileBytes ?? DEFAULT_MAX_SINGLE_FILE_BYTES;

  return withSnapshot(actor.tenantId, async (client) => {
    const plan: ExportPlan = await buildPlan(client);
    const { rows: tenantRows } = await client.query("SELECT name, code FROM tenants WHERE id = $1", [actor.tenantId]);
    const tenantName = (tenantRows[0]?.name as string | undefined) ?? null;
    const ext = opts.format === "json" ? "jsonl" : "csv";

    archive.append(README({ tenantName: tenantName ?? `tenant ${actor.tenantId}`, format: opts.format, includeFiles: opts.includeFiles }), { name: "README.txt" });

    const manifest: ExportManifest = {
      exportedAt: new Date().toISOString(),
      format: opts.format,
      tenant: { id: actor.tenantId, name: tenantName, code: (tenantRows[0]?.code as string | undefined) ?? null },
      exportedBy: { id: actor.userId, email: actor.email },
      appVersion: env.APP_VERSION,
      includeFiles: opts.includeFiles,
      tables: [],
      excludedTables: plan.excluded,
      files: { included: 0, bytes: 0, skipped: [] },
      totalRows: 0,
    };

    const fileRefs = new Map<string, { table: string; stored: string }>();

    for (const t of plan.tables) {
      let rows = 0;
      let truncated = false;
      const file = `data/${t.table}.${ext}`;
      await appendStreamed(archive, file, async (out) => {
        if (opts.format === "csv") await write(out, `${t.columns.map((c) => csvField(c)).join(",")}\n`);
        for await (const batch of readTable(client, t, actor.tenantId, rowCap)) {
          truncated ||= batch.truncated;
          let chunk = "";
          for (const row of batch.rows) {
            rows++;
            if (opts.includeFiles) for (const c of t.fileColumns) if (typeof row[c] === "string" && row[c]) fileRefs.set(`${t.table}:${row[c]}`, { table: t.table, stored: row[c] as string });
            chunk += opts.format === "json" ? `${JSON.stringify(Object.fromEntries(t.columns.map((c) => [c, cell(row[c])])))}\n` : `${t.columns.map((c) => csvField(row[c])).join(",")}\n`;
          }
          await write(out, chunk);
        }
      });
      manifest.tables.push({ name: t.table, file, rows, truncated, omittedColumns: t.omittedColumns });
      manifest.totalRows += rows;
    }

    if (opts.includeFiles) {
      let n = 0;
      for (const { table, stored } of fileRefs.values()) {
        const resolved = resolveTenantFile(actor.tenantId, stored);
        if (!resolved) {
          manifest.files.skipped.push({ path: stored, reason: "not one of this organization's uploaded files (built-in template or outside its storage folder)" });
          continue;
        }
        try {
          const info = await stat(resolved);
          if (!info.isFile()) throw new Error("not a file");
          if (info.size > maxSingleFileBytes) {
            manifest.files.skipped.push({ path: stored, reason: `larger than ${Math.round(maxSingleFileBytes / 1048576)} MB` });
            continue;
          }
          if (manifest.files.bytes + info.size > maxFileBytes) {
            manifest.files.skipped.push({ path: stored, reason: "the export's total file size limit was reached" });
            continue;
          }
          archive.append(createReadStream(resolved), { name: `files/${table}/${++n}-${path.basename(resolved).replace(/[^\w.\- ]+/g, "_")}` });
          manifest.files.included++;
          manifest.files.bytes += info.size;
        } catch {
          manifest.files.skipped.push({ path: stored, reason: "the file is no longer in storage" });
        }
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    return manifest;
  });
}

/** Creates the ZIP writer the routes pipe into the response. */
export function newArchive(onWarning: (err: Error) => void = (e) => logger.warn("data export archive warning", { err: String(e) })): Archiver {
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("warning", onWarning);
  return archive;
}
