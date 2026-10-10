import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import type { ClaimBookMonth } from "../quality-engineering-report/financials.js";
import { optionalRows } from "../sites/optionalSql.js";

/** A chosen plant keeps its own rows and rows that were never assigned. Null siteId means every plant. */
export function plantSql(siteId: number | null): ReturnType<typeof sql> {
  if (siteId == null) return sql`true`;
  return sql`(site_id = ${siteId} OR site_id IS NULL)`;
}

function monthRows(rows: { month: string; count: number; hours: number | null; cost_rows: number; cost: number | null }[] | null): ClaimBookMonth[] | null {
  if (rows == null) return null;
  return rows.map((row) => ({
    month: row.month,
    count: Number(row.count ?? 0),
    hours: Number(row.hours ?? 0),
    cost: Number(row.cost_rows ?? 0) > 0 ? Number(row.cost ?? 0) : null,
  }));
}

export async function laborBooksBetween(db: Db, start: Date, end: Date, siteId: number | null): Promise<ClaimBookMonth[] | null> {
  const rows = await optionalRows<{ month: string; count: number; hours: number | null; cost_rows: number; cost: number | null }>(
    db,
    sql`
      SELECT to_char(date_trunc('month', coalesce(claim_date, created_at)), 'YYYY-MM') AS month,
             count(*)::int AS count,
             coalesce(sum(labor_hours), 0)::float AS hours,
             count(total_labor_cost)::int AS cost_rows,
             coalesce(sum(total_labor_cost), 0)::float AS cost
      FROM labor_claims
      WHERE coalesce(claim_date, created_at) >= ${start}
        AND coalesce(claim_date, created_at) < ${end}
        AND ${plantSql(siteId)}
      GROUP BY 1
      ORDER BY 1
    `,
  );
  return monthRows(rows);
}

export async function warrantyBooksBetween(db: Db, start: Date, end: Date, siteId: number | null): Promise<ClaimBookMonth[] | null> {
  const rows = await optionalRows<{ month: string; count: number; hours: number | null; cost_rows: number; cost: number | null }>(
    db,
    sql`
      SELECT to_char(date_trunc('month', coalesce(failure_date, created_at)), 'YYYY-MM') AS month,
             count(*)::int AS count,
             0::float AS hours,
             count(warranty_actual_cost)::int AS cost_rows,
             coalesce(sum(warranty_actual_cost), 0)::float AS cost
      FROM warranty_claims
      WHERE coalesce(failure_date, created_at) >= ${start}
        AND coalesce(failure_date, created_at) < ${end}
        AND ${plantSql(siteId)}
      GROUP BY 1
      ORDER BY 1
    `,
  );
  return monthRows(rows);
}
