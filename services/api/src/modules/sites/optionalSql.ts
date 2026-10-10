import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  if ("cause" in err) return pgCode((err as { cause?: unknown }).cause);
  return null;
}

let seq = 0;

/**
 * Run one statement in a savepoint. A missing table or column returns null
 * so a deploy can run before its migration. Any other error is rethrown.
 */
export async function optionalRows<T extends Record<string, unknown>>(db: Db, statement: SQL): Promise<T[] | null> {
  const name = `opt_sql_${++seq}`;
  await db.execute(sql.raw(`SAVEPOINT ${name}`));
  try {
    const result = await db.execute(statement);
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    return (result.rows ?? []) as T[];
  } catch (err) {
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`)).catch(() => undefined);
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`)).catch(() => undefined);
    const code = pgCode(err);
    if (code === "42P01" || code === "42703") return null;
    throw err;
  }
}

export function sqlIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected identifier "${name}"`);
  return `"${name}"`;
}
