// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (medium), a real companion to test/rls-coverage.test.ts
// rather than a duplicate: that one is pure-logic (checks rls-policies.sql's
// tenant_tables array text against the Drizzle schema, no DB connection) — it
// catches a table missing from the array, but can't catch the array being
// correct while `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` was never
// actually applied to a given database (a migration/deploy drift, not a
// source-code drift). This test queries the live database directly, so it
// stays correct even if rls-policies.sql's own array drifts from reality.
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/index.js";

describe("RLS coverage drift guard (live database)", () => {
  it("every table with a tenant_id column has row-level security actually enabled", async () => {
    const { rows } = await pool.query<{ table_name: string; relrowsecurity: boolean }>(`
      SELECT DISTINCT c.relname AS table_name, c.relrowsecurity
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE col.table_schema = 'public' AND col.column_name = 'tenant_id'
    `);
    const withoutRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.table_name).sort();
    expect(withoutRls, `these tenant_id tables have no RLS policy enabled on this database: ${withoutRls.join(", ")}`).toEqual([]);
  });
});
