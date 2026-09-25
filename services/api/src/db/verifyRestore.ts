import "dotenv/config";
import fs from "node:fs";
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
 *
 * Second mode, for when the original no longer exists (a real recovery, or the monthly automated drill): set
 * MANIFEST_FILE=<manifest.json from a backup> instead of SOURCE_DATABASE_URL. The manifest holds the exact row counts and
 * structure counts taken from the same snapshot as the dump (ops/backup/backup.mjs), so the restored copy is checked against
 * what the database looked like at the moment of the backup, not against a live database that has moved on since.
 *
 * A backup is usually older than the newest migration in the repository, so restoring it and then running db:migrate
 * legitimately changes the structure. The manifest check is therefore split with VERIFY_PHASE:
 *   VERIFY_PHASE=data   right after pg_restore, BEFORE db:migrate: structure, migration history, every row count, sequences
 *   VERIFY_PHASE=roles  after db:migrate: the application role exists and can read every table, and the schema is at or ahead of the backup
 *   (unset)             both — only meaningful when the repository and the backup are at the same migration
 */

const source = process.env.SOURCE_DATABASE_URL;
const target = process.env.DATABASE_URL;
const manifestFile = process.env.MANIFEST_FILE;
if ((!source && !manifestFile) || !target) {
  console.error("Set DATABASE_URL (the restored copy) and either SOURCE_DATABASE_URL (the original) or MANIFEST_FILE (a backup's manifest.json).");
  process.exit(2);
}
if (source && source === target) {
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

interface Manifest {
  migrations: number;
  catalog: Record<string, number>;
  tables: Record<string, number>;
}

/** Verifies a restored copy against a backup's manifest (no original database available). */
async function verifyAgainstManifest(file: string): Promise<void> {
  const phase = process.env.VERIFY_PHASE ?? "all";
  if (!["all", "data", "roles"].includes(phase)) {
    console.error('VERIFY_PHASE must be "data", "roles", or unset.');
    process.exit(2);
  }
  const m = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
  const b = mk(target!);
  const problems: string[] = [];
  const line = (ok: boolean, label: string, detail = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  try {
    const migrations = await scalar(b, "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");

    if (phase !== "roles") {
      for (const [name, sql] of Object.entries(CATALOG_QUERIES)) {
        if (name === "appRoleExists" || name === "appRoleReadableTables") continue; // not in a backup by design; checked in the roles phase
        const want = m.catalog[name];
        if (want === undefined) continue;
        const got = await scalar(b, sql);
        line(got === want, name, got === want ? String(got) : `backup ${want}, restored ${got}`);
        if (got !== want) problems.push(`${name}: backup ${want}, restored ${got}`);
      }
      line(migrations === m.migrations, "migration history", `${migrations} recorded`);
      if (migrations !== m.migrations) problems.push(`migration history: backup ${m.migrations}, restored ${migrations}`);
    }

    if (phase !== "data") {
      // After db:migrate the application role must exist and be able to read every table that now exists.
      const roleOk = (await scalar(b, CATALOG_QUERIES.appRoleExists!)) === 1;
      const readable = await scalar(b, CATALOG_QUERIES.appRoleReadableTables!);
      const tablesNow = await scalar(b, CATALOG_QUERIES.tables!);
      line(roleOk, "application role exists");
      line(readable === tablesNow, "application role can read every table", `${readable} of ${tablesNow}`);
      line(migrations >= m.migrations, "schema is at or ahead of the backup", `${migrations} migrations, backup had ${m.migrations}`);
      if (!roleOk) problems.push("application role missing");
      if (readable !== tablesNow) problems.push(`application role reads ${readable} of ${tablesNow} tables`);
      if (migrations < m.migrations) problems.push(`schema has ${migrations} migrations but the backup had ${m.migrations}`);
    }
    if (phase === "roles") {
      console.log("\nROLES VERIFIED — the application role and its grants are in place.");
      process.exit(problems.length === 0 ? 0 : 1);
    }

    const got = await tableCounts(b);
    const diffs: string[] = [];
    let total = 0;
    for (const [t, n] of Object.entries(m.tables)) {
      total += got.get(t) ?? 0;
      if ((got.get(t) ?? -1) !== n) diffs.push(`${t}: backup ${n}, restored ${got.get(t) ?? "MISSING"}`);
    }
    for (const t of got.keys()) if (!(t in m.tables)) diffs.push(`${t}: only in the restored copy`);
    line(diffs.length === 0, `row counts for all ${Object.keys(m.tables).length} tables`, diffs.length === 0 ? `${total.toLocaleString()} rows` : `${diffs.length} differ`);
    for (const d of diffs) console.log(`        ${d}`);
    problems.push(...diffs);

    const behind = await sequencesBehind(b);
    line(behind.length === 0, "id sequences are ahead of the data", behind.length ? `${behind.length} behind` : "no collisions possible");
    for (const x of behind) console.log(`        ${x}`);
    problems.push(...behind.map((x) => `sequence behind: ${x}`));
  } finally {
    await b.end();
  }
  console.log(problems.length === 0 ? "\nRESTORE VERIFIED — the restored database matches the backup's manifest." : `\nRESTORE DIFFERS — ${problems.length} problem(s) above.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

async function main() {
  if (manifestFile) return verifyAgainstManifest(manifestFile);
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
