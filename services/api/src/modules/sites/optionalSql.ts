import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  if ("cause" in err) return pgCode((err as { cause?: unknown }).cause);
  return null;
}

let seq = 0;

// Queue to serialize savepoint operations on the same connection
const pendingOps = new Map<Db, Promise<void>>();

function missingRelation(err: unknown): boolean {
  const code = pgCode(err);
  return code === "42P01" || code === "42703";
}

function errorText(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const message = "message" in err && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  const cause = "cause" in err ? errorText((err as { cause?: unknown }).cause) : "";
  return `${message} ${cause}`;
}

/** SAVEPOINT is only valid inside a transaction. The owner pool used by imports is not one. */
function outsideTransaction(err: unknown): boolean {
  if (pgCode(err) === "25P01") return true;
  return /SAVEPOINT can only be used in transaction blocks/i.test(errorText(err));
}

async function rowsOrMissing<T extends Record<string, unknown>>(db: Db, statement: SQL): Promise<T[] | null> {
  try {
    const result = await db.execute(statement);
    return (result.rows ?? []) as T[];
  } catch (err) {
    if (missingRelation(err)) return null;
    throw err;
  }
}

/**
 * Run one statement in a savepoint. A missing table or column returns null
 * so a deploy can run before its migration. Any other error is rethrown.
 * Operations on the same db connection are serialized to avoid savepoint conflicts.
 * Outside a transaction the statement runs on its own.
 */
export async function optionalRows<T extends Record<string, unknown>>(db: Db, statement: SQL): Promise<T[] | null> {
  // Serialize operations on this connection
  const previous = pendingOps.get(db) ?? Promise.resolve();
  let resolve!: () => void;
  const current = new Promise<void>((r) => { resolve = r; });
  pendingOps.set(db, current);

  try {
    await previous;

    const name = `opt_sql_${++seq}`;
    try {
      await db.execute(sql.raw(`SAVEPOINT ${name}`));
    } catch (err) {
      if (!outsideTransaction(err)) throw err;
      return await rowsOrMissing(db, statement);
    }
    try {
      const result = await db.execute(statement);
      await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
      return (result.rows ?? []) as T[];
    } catch (err) {
      await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`)).catch(() => undefined);
      await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`)).catch(() => undefined);
      if (missingRelation(err)) return null;
      throw err;
    }
  } finally {
    resolve();
  }
}

export function sqlIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected identifier "${name}"`);
  return `"${name}"`;
}
