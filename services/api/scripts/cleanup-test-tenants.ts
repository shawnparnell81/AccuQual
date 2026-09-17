// Phase 1 task 1: remove the leftover automated-test tenants that used to
// accumulate in this same database (root cause fixed in Phase 0 — see
// test/setup.ts and .env.test). Every tenant-owned table carries its own
// tenant_id column by convention (see tenants.ts's own schema comment), but
// there are 244 real FK constraints in this schema and no ON DELETE CASCADE
// on almost any of them — a plain `DELETE FROM tenants` fails immediately on
// the first referencing row. Rather than hand-enumerate 40+ tables in the
// right order, this builds the actual FK dependency graph from Postgres's
// own catalog and computes a real topological delete order (Kahn's
// algorithm): a table is safe to clear once every OTHER table that
// references it has already been cleared.
//
// Usage:
//   npx tsx scripts/cleanup-test-tenants.ts --dry-run   (default — no writes)
//   npx tsx scripts/cleanup-test-tenants.ts --execute   (real DELETEs, one transaction)
import { pool } from "../src/db/index.js";

// Explicit allowlist of tenant IDs to KEEP — everything else in the tenants
// table gets deleted. Listing what to keep (not a name/code pattern to
// match for deletion) is the safer direction: a pattern that's slightly too
// broad silently deletes a real tenant, while a keep-list that's slightly
// too narrow just fails loudly (nothing here matches "keep" but also isn't
// a known test tenant) — reviewed against a fresh `SELECT id, name, code
// FROM tenants ORDER BY id` before running.
const KEEP_TENANT_IDS = [1]; // Demo Manufacturing Co.

interface FkEdge {
  referencingTable: string;
  referencedTable: string;
}

async function getForeignKeyGraph(): Promise<FkEdge[]> {
  const { rows } = await pool.query<{ referencing_table: string; referenced_table: string }>(`
    SELECT DISTINCT
      conrelid::regclass::text AS referencing_table,
      confrelid::regclass::text AS referenced_table
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  `);
  return rows.map((r) => ({ referencingTable: r.referencing_table, referencedTable: r.referenced_table }));
}

async function getTablesWithTenantId(): Promise<Set<string>> {
  const { rows } = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  `);
  return new Set(rows.map((r) => r.table_name));
}

/** Kahn's algorithm: a table can be cleared once every table that references it has already been cleared. */
function topologicalDeleteOrder(edges: FkEdge[], allTables: Set<string>): string[] {
  const referencedBy = new Map<string, Set<string>>(); // table -> set of tables with an FK pointing at it, not yet cleared
  for (const table of allTables) referencedBy.set(table, new Set());
  for (const { referencingTable, referencedTable } of edges) {
    if (referencingTable === referencedTable) continue; // self-referencing FK (e.g. a parent_id column) — never blocks clearing a table's own rows
    if (!allTables.has(referencedTable) || !allTables.has(referencingTable)) continue;
    referencedBy.get(referencedTable)!.add(referencingTable);
  }

  const order: string[] = [];
  const remaining = new Set(allTables);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) => [...referencedBy.get(t)!].every((r) => !remaining.has(r)));
    if (ready.length === 0) {
      throw new Error(`Foreign key cycle detected among remaining tables — can't compute a safe delete order: ${[...remaining].join(", ")}`);
    }
    for (const table of ready.sort()) {
      order.push(table);
      remaining.delete(table);
    }
  }
  return order;
}

async function main() {
  const execute = process.argv.includes("--execute");

  const { rows: allTenants } = await pool.query<{ id: number; name: string; code: string }>("SELECT id, name, code FROM tenants ORDER BY id");
  const toDelete = allTenants.filter((t) => !KEEP_TENANT_IDS.includes(t.id));
  const toKeep = allTenants.filter((t) => KEEP_TENANT_IDS.includes(t.id));

  console.log(`Tenants to KEEP (${toKeep.length}): ${toKeep.map((t) => `#${t.id} ${t.name}`).join(", ")}`);
  console.log(`Tenants to DELETE (${toDelete.length}):`);
  for (const t of toDelete) console.log(`  #${t.id} ${t.name} (${t.code})`);
  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    await pool.end();
    return;
  }

  const ids = toDelete.map((t) => t.id);
  const edges = await getForeignKeyGraph();
  const tenantScopedTables = await getTablesWithTenantId();
  const allTables = new Set([...tenantScopedTables, "tenants"]);
  const order = topologicalDeleteOrder(edges, allTables).filter((t) => t !== "tenants");

  console.log(`\nDelete order (${order.length} tenant-scoped tables, then tenants):`);
  console.log(order.join(", "));

  console.log(`\n${execute ? "EXECUTING" : "DRY RUN — pass --execute to actually delete"}\n`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let totalRows = 0;
    for (const table of order) {
      const n = execute
        ? (await client.query(`DELETE FROM "${table}" WHERE tenant_id = ANY($1::int[])`, [ids])).rowCount ?? 0
        : (await client.query(`SELECT count(*)::int AS n FROM "${table}" WHERE tenant_id = ANY($1::int[])`, [ids])).rows[0].n;
      if (n > 0) {
        console.log(`  ${table}: ${execute ? "deleted" : "would delete"} ${n} row(s)`);
        totalRows += n;
      }
    }
    const tenantDelete = execute
      ? await client.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [ids])
      : await client.query(`SELECT count(*)::int AS n FROM tenants WHERE id = ANY($1::int[])`, [ids]);
    console.log(`  tenants: ${execute ? "deleted" : "would delete"} ${execute ? tenantDelete.rowCount : tenantDelete.rows[0].n} row(s)`);

    if (execute) {
      await client.query("COMMIT");
      console.log(`\nDone — ${totalRows} child rows + ${ids.length} tenant(s) removed.`);
    } else {
      await client.query("ROLLBACK"); // dry run never commits, even though it only ran SELECTs
      console.log("\nDry run complete — no changes made. Re-run with --execute to apply.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
