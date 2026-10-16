import type { Request, Response } from "express";
import { and, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { orderByShape, parseLimitOffset, parseListShape, searchWhere, setListHeaders } from "./listQuery.js";
import type { Db } from "../lib/requestDb.js";

interface PagedListOptions<Row> {
  table: PgTable;
  /** The handler's own filters (status, supplier, dates, plant). */
  conditions: (SQL | undefined)[];
  /** Order used when the page does not ask for one; the handler's existing order. */
  defaultOrder: SQL[];
  /** Runs the handler's own select with the final where, order and page. */
  select: (where: SQL | undefined, order: SQL[], limit: number, offset: number) => Promise<Row[]>;
  /** Extra text a search should read, such as a joined name. */
  searchAlso?: SQL[];
  /** Column whose values the summary cards count. */
  statusColumn?: SQL | PgTable[keyof PgTable];
  /** Rows an unpaged call returns. Endpoints that already capped their list keep that cap. */
  unpagedLimit?: number;
}

/**
 * Server-side paging, sorting and search for a list endpoint. The response is
 * still an array, so pickers and older callers keep working; `limit`/`offset`
 * ask for one page and add X-Total-Count (and X-Status-Counts with
 * `counts=status`). `q` searches every text column; `sort`/`dir` name a column.
 */
export async function pagedList<Row>(req: Request, res: Response, options: PagedListOptions<Row>): Promise<Row[]> {
  const db = req.db as Db;
  const query = req.query as Record<string, unknown>;
  const shape = parseListShape(query);
  const conditions = options.conditions.filter((item): item is SQL => item !== undefined);
  const search = searchWhere(options.table, shape.q, options.searchAlso);
  if (search) conditions.push(search);
  const where = conditions.length ? and(...conditions) : undefined;
  const { limit, offset, paginated } = parseLimitOffset(query);
  const order = shape.sort ? orderByShape(options.table, shape) : paginated ? [...options.defaultOrder, ...orderByShape(options.table, { q: "", sort: "id", dir: "desc" })] : options.defaultOrder;
  // Without a page request the endpoint answers as it did before this helper (every matching row).
  const rows = await options.select(where, order, paginated ? limit : (options.unpagedLimit ?? 1_000_000), paginated ? offset : 0);
  if (paginated) {
    const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(options.table).where(where);
    let statusCounts: Record<string, number> | undefined;
    if (options.statusColumn && query.counts === "status") {
      const status = options.statusColumn as SQL;
      const grouped = await db.select({ status: sql<string>`${status}`, count: sql<number>`count(*)::int` }).from(options.table).where(where).groupBy(sql`${status}`);
      statusCounts = Object.fromEntries(grouped.map((row) => [String(row.status ?? ""), row.count]));
    }
    setListHeaders(res, count?.count ?? rows.length, statusCounts);
  }
  return rows;
}
