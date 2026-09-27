import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { REMOVABLE_USER_LINK_TABLES, summarizeHistory, type HistoryHit } from "./userRemoval.js";

function bareName(value: string): string {
  const cleaned = value.replace(/"/g, "");
  const parts = cleaned.split(".");
  return parts[parts.length - 1] ?? cleaned;
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected column or table name "${name}"`);
  return `"${name}"`;
}

/** Quality and other records that mention this person. Session rows are left out; those are removed with a hard delete. */
export async function loadUserHistory(db: Db, userId: number): Promise<HistoryHit[]> {
  const found = await db.execute(sql`
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
  `);
  const rows = (found.rows ?? []) as { table_name: string; column_name: string }[];
  const byTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = bareName(row.table_name);
    if (table === "users" || REMOVABLE_USER_LINK_TABLES.has(table)) continue;
    const columns = byTable.get(table) ?? new Set<string>();
    columns.add(row.column_name);
    byTable.set(table, columns);
  }

  const hits: { table: string; count: number }[] = [];
  for (const [table, columns] of byTable) {
    const where = [...columns].map((column) => `${ident(column)} = ${Number(userId)}`).join(" OR ");
    const counted = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${ident(table)} WHERE ${where}`));
    const count = Number((counted.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
    if (count > 0) hits.push({ table, count });
  }
  return summarizeHistory(hits);
}
