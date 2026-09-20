/**
 * What a tenant data export contains, decided in one place.
 *
 * The rule is "everything the tenant owns, except what would hand out a credential or is not readable data".
 * Tables are discovered from the database (every table with a tenant_id column) rather than listed by hand, so a
 * table added next month is exported automatically — and a test (data-export.test.ts) fails if a new table has a
 * secret-looking column that is not being withheld, or if it is neither exported nor deliberately excluded here.
 */

/** Tables that are deliberately not exported, with the reason shown to the administrator. */
export const EXCLUDED_TABLES: Record<string, string> = {
  ai_embeddings: "Machine-generated search vectors derived from your records. They are not readable data and are rebuilt from the records themselves.",
};

/** Column names that could carry a credential. Withheld from every table, and their names listed in the manifest. */
export const SECRET_COLUMN = /(password|passwd|secret|api_?key|encrypted|ciphertext|credential|token|_hash$|^hash$)/i;
/** Look secret-ish by name but are only timestamps/counters. */
export const NOT_SECRET_COLUMNS = new Set(["password_changed_at", "api_key_created_at", "token_version"]);
/** Withheld even though the name looks harmless: session/lockout bookkeeping, not the tenant's records. */
export const ALWAYS_WITHHELD_COLUMNS = new Set(["token_version", "mfa_last_used_step", "failed_login_count", "first_failed_login_at", "locked_until"]);

export const isWithheldColumn = (name: string): boolean => ALWAYS_WITHHELD_COLUMNS.has(name) || (SECRET_COLUMN.test(name) && !NOT_SECRET_COLUMNS.has(name));

/** Columns whose value is the path of a file the tenant uploaded (only files inside the tenant's own storage folder are ever included). */
export const FILE_COLUMN = /(^|_)(file_path|certificate_path|pdf_path)$/;

/** Keys that never leave, wherever they appear inside a JSON value (e.g. tenants.ai_config.apiKeyEncrypted). */
const SECRET_JSON_KEY = /(password|secret|api_?key|encrypted|token|credential)/i;

/** Recursively drops secret-looking keys from a JSON value. */
export function scrubJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SECRET_JSON_KEY.test(k)) out[k] = scrubJson(v);
    return out;
  }
  return value;
}

export interface TablePlan {
  table: string;
  columns: string[];
  omittedColumns: string[];
  fileColumns: string[];
  hasId: boolean;
  /** "tenant_id" for ordinary tables, "id" for the tenants table itself. */
  scopeColumn: "tenant_id" | "id";
}

export interface ExportPlan {
  tables: TablePlan[];
  excluded: { table: string; reason: string }[];
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Reads the live schema and builds the plan. Runs on whatever connection is passed, so it sees exactly what that role may read. */
export async function buildPlan(client: Queryable): Promise<ExportPlan> {
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' UNION SELECT 'tenants')
     ORDER BY table_name, ordinal_position`,
  );
  const byTable = new Map<string, string[]>();
  for (const r of rows) byTable.set(String(r.table_name), [...(byTable.get(String(r.table_name)) ?? []), String(r.column_name)]);

  const tables: TablePlan[] = [];
  const excluded: { table: string; reason: string }[] = [];
  for (const [table, all] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (EXCLUDED_TABLES[table]) {
      excluded.push({ table, reason: EXCLUDED_TABLES[table]! });
      continue;
    }
    const columns = all.filter((c) => !isWithheldColumn(c));
    tables.push({
      table,
      columns,
      omittedColumns: all.filter((c) => isWithheldColumn(c)),
      fileColumns: columns.filter((c) => FILE_COLUMN.test(c)),
      hasId: all.includes("id"),
      scopeColumn: table === "tenants" ? "id" : "tenant_id",
    });
  }
  return { tables, excluded };
}
