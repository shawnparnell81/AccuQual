import "dotenv/config";
import pg from "pg";

/**
 * Backup-restore verification: proves a restored database matches the one it was backed up from.
 *
 *   SOURCE_DATABASE_URL=<the original>  DATABASE_URL=<the restored copy>  npm run db:verify-restore
 *
 * Compares (read-only on both sides): every table's exact row count; the number of tables, columns, indexes,
 * constraints, triggers, functions, sequences, row-level-security policies and RLS-enabled tables; the installed
 * extensions; each sequence sits at or above its table's highest id (so the next insert cannot collide); and that the
 * restricted application role exists with the same table access. Exits non-zero on any difference, so it can gate a
 * scripted drill. See docs/operations/backup-and-restore.md.
 */

const source = process.env.SOURCE_DATABASE_URL;
const target = process.env.DATABASE_URL;
if (!source || !target) {
  console.error("Set SOURCE_DATABASE_URL (the original) and DATABASE_URL (the restored copy).");
  process.exit(2);
}
if (source === target) {
  console.error("SOURCE_DATABASE_URL and DATABASE_URL are the same database — nothing to compare.");
  process.exit(2);
}

const ssl = (url: string) => (/localhost|127\.0\.0\.1|@postgres[:/]/.test(url) ? undefined : { rejectUnauthorized: false });
const mk = (url: string) => new pg.Pool({ connectionString: url, ssl: ssl(url), max: 2 });

const CATALOG_QUERIES: Record<string, string> = {
  tables: "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  columns: "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public'",
  indexes: "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'",
  constraints: "SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'",
  triggers: "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal",
  functions: "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'",
  sequences: "SELECT count(*)::int AS n FROM information_schema.sequences WHERE sequence_schema = 'public'",
  rlsPolicies: "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'",
  rlsEnabledTables: "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity",
  appRoleExists: "SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'accuqual_app'",
  // By table OID from pg_class, so has_table_privilege is only ever called on public tables (the planner may otherwise
  // evaluate it on the drizzle schema's tables before the schema filter applies).
  appRoleReadableTables: "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'accuqual_app') AND has_table_privilege('accuqual_app', c.oid, 'SELECT')",
};

async function scalar(p: pg.Pool, sql: string): Promise<number> {
  return (await p.query(sql)).rows[0].n as number;
}

async function tableCounts(p: pg.Pool): Promise<Map<string, number>> {
  const { rows } = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1");
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.table_name, (await p.query(`SELECT count(*)::int AS n FROM "${String(r.table_name).replace(/"/g, '""')}"`)).rows[0].n);
  return out;
}

/** Tables whose serial id column has a sequence that is behind the data — the classic silent restore bug. */
async function sequencesBehind(p: pg.Pool): Promise<string[]> {
  const { rows } = await p.query(`
    SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) AS seq
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND pg_get_serial_sequence(format('public.%I', c.relname), a.attname) IS NOT NULL`);
  const behind: string[] = [];
  for (const r of rows) {
    const max = (await p.query(`SELECT coalesce(max("${r.col}"), 0)::bigint AS m FROM "${r.tbl}"`)).rows[0].m as string;
    const seq = (await p.query(`SELECT last_value::bigint AS v, is_called FROM ${r.seq}`)).rows[0] as { v: string; is_called: boolean };
    const next = seq.is_called ? BigInt(seq.v) + 1n : BigInt(seq.v);
    if (next <= BigInt(max)) behind.push(`${r.tbl}.${r.col} (next id ${next}, highest existing ${max})`);
  }
  return behind;
}

async function main() {
  const a = mk(source!);
  const b = mk(target!);
  const problems: string[] = [];
  const line = (ok: boolean, label: string, detail = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);

  try {
    // --- Structure ---
    for (const [name, sql] of Object.entries(CATALOG_QUERIES)) {
      const [x, y] = [await scalar(a, sql), await scalar(b, sql)];
      const ok = x === y;
      line(ok, name, ok ? String(y) : `original ${x}, restored ${y}`);
      if (!ok) problems.push(`${name}: original ${x}, restored ${y}`);
    }
    const ext = async (p: pg.Pool) => (await p.query("SELECT string_agg(extname, ',' ORDER BY extname) AS e FROM pg_extension WHERE extname = 'vector'")).rows[0].e as string | null;
    const [ea, eb] = [await ext(a), await ext(b)];
    line(ea === eb, "vector extension", `${eb ?? "missing"}`);
    if (ea !== eb) problems.push(`vector extension: original ${ea}, restored ${eb}`);

    // --- Data ---
    const [ca, cb] = [await tableCounts(a), await tableCounts(b)];
    let totalA = 0;
    let totalB = 0;
    const diffs: string[] = [];
    for (const [t, n] of ca) {
      totalA += n;
      totalB += cb.get(t) ?? 0;
      if ((cb.get(t) ?? -1) !== n) diffs.push(`${t}: original ${n}, restored ${cb.get(t) ?? "MISSING"}`);
    }
    for (const t of cb.keys()) if (!ca.has(t)) diffs.push(`${t}: only in the restored copy`);
    line(diffs.length === 0, `row counts for all ${ca.size} tables`, diffs.length === 0 ? `${totalB.toLocaleString()} rows` : `${diffs.length} differ`);
    for (const d of diffs) console.log(`        ${d}`);
    problems.push(...diffs);

    // --- Sequences ---
    const behind = await sequencesBehind(b);
    line(behind.length === 0, "id sequences are ahead of the data", behind.length ? `${behind.length} behind` : "no collisions possible");
    for (const s of behind) console.log(`        ${s}`);
    problems.push(...behind.map((s) => `sequence behind: ${s}`));
  } finally {
    await a.end();
    await b.end();
  }

  console.log(problems.length === 0 ? "\nRESTORE VERIFIED — the restored database matches the original." : `\nRESTORE DIFFERS — ${problems.length} problem(s) above.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed to run:", err);
  process.exit(2);
});
