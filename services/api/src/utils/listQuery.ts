import { asc, desc, getTableColumns, is, sql, Table, type AnyColumn, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** Shared bound for list endpoints. High enough that a normal register still fits; low enough that one page can't pull an unbounded table. */
export const LIST_SAFETY_LIMIT = 2000;

/**
 * `limit` and `offset` are optional. When either is present the handler should
 * also send `X-Total-Count` so the caller can page. Missing values keep the
 * safety cap and start at the first row, which is what every existing list
 * already did.
 */
export function parseLimitOffset(query: Record<string, unknown>): { limit: number; offset: number; paginated: boolean } {
  const paginated = query.limit != null || query.offset != null;
  const requestedLimit = query.limit != null && query.limit !== "" ? Number(query.limit) : LIST_SAFETY_LIMIT;
  const limit = Number.isInteger(requestedLimit) ? Math.min(LIST_SAFETY_LIMIT, Math.max(1, requestedLimit)) : LIST_SAFETY_LIMIT;
  const requestedOffset = query.offset != null && query.offset !== "" ? Number(query.offset) : 0;
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  return { limit, offset, paginated };
}

/** Rows per page when a list page loads a long register a page at a time. */
export const LIST_PAGE_SIZE = 150;

const SECRET_COLUMN = /password|secret|token|hash|mfa|recovery/i;
const TEXT_TYPES = new Set(["PgText", "PgVarchar", "PgChar"]);

export interface ListShape {
  /** Free text from the search box. Matched in every text column and the id. */
  q: string;
  /** A column name the table has. Anything else is ignored. */
  sort: string | null;
  dir: "asc" | "desc";
}

export function parseListShape(query: Record<string, unknown>): ListShape {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 200) : "";
  const sort = typeof query.sort === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(query.sort) ? query.sort : null;
  const dir = query.dir === "asc" ? "asc" : "desc";
  return { q, sort, dir };
}

type Columns = Record<string, AnyColumn>;

function columnsOf(table: PgTable | Columns): Columns {
  return is(table, Table) ? (getTableColumns(table as PgTable) as Columns) : (table as Columns);
}

/** The text columns a search reads. Secrets and hashes are never searched. */
export function searchableColumns(table: PgTable | Columns): AnyColumn[] {
  return Object.entries(columnsOf(table))
    .filter(([name, column]) => TEXT_TYPES.has((column as { columnType?: string }).columnType ?? "") && !SECRET_COLUMN.test(name))
    .map(([, column]) => column);
}

/** Case-insensitive match of every word of `q` in any searchable column or the id. Null when there is nothing to match. */
export function searchWhere(table: PgTable | Columns, q: string, extra: (AnyColumn | SQL)[] = []): SQL | undefined {
  if (!q) return undefined;
  const columns = columnsOf(table);
  const parts: (AnyColumn | SQL)[] = [...searchableColumns(table), ...extra];
  if (columns.id) parts.push(sql`${columns.id}::text`);
  if (parts.length === 0) return undefined;
  const haystack = sql`concat_ws(' ', ${sql.join(parts.map((part) => sql`${part}`), sql`, `)})`;
  const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
  return sql.join(words.map((word) => sql`${haystack} ILIKE ${`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`), sql` AND `);
}

/** ORDER BY for a list page. Unknown sort keys fall back to newest first; the id breaks ties so pages never overlap. */
export function orderByShape(table: PgTable | Columns, shape: ListShape, fallback = "id"): SQL[] {
  const columns = columnsOf(table);
  const key = shape.sort && columns[shape.sort] ? shape.sort : columns[fallback] ? fallback : null;
  const out: SQL[] = [];
  if (key) {
    const column = columns[key]!;
    out.push(shape.dir === "asc" ? sql`${asc(column)} NULLS LAST` : sql`${desc(column)} NULLS LAST`);
  }
  if (columns.id && key !== "id") out.push(desc(columns.id) as unknown as SQL);
  return out;
}

/**
 * Headers a paged list sends: the full count for "Showing 150 of 5,000" and,
 * when the table has a status, the count of each status across every match
 * (the summary cards, not only the loaded page).
 */
export function setListHeaders(res: { setHeader(name: string, value: string): void }, total: number, statusCounts?: Record<string, number>) {
  res.setHeader("X-Total-Count", String(total));
  if (statusCounts) res.setHeader("X-Status-Counts", encodeURIComponent(JSON.stringify(statusCounts)));
}
