// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (medium), a real companion to test/rls-coverage.test.ts
// rather than a duplicate: that one is pure-logic (checks rls-policies.sql's
// tenant_tables array text against the Drizzle schema, no DB connection) — it
// catches a table missing from the array, but can't catch the array being
// correct while `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` was never
// actually applied to a given database (a migration/deploy drift, not a
// source-code drift). This test queries the live database directly, so it
// stays correct even if rls-policies.sql's own array drifts from reality.
//
// It also guards the opposite failure, found live on Supabase: RLS switched ON
// (by Supabase's `ensure_rls` event trigger) for a table with NO policy, which
// hides every row from the app's accuqual_app role — `tenants` was invisible to
// every tenant-scoped request ("Tenant not found" on branding/AI config/ERP
// sync settings) while local/CI Postgres, which has no such trigger, passed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";

const suffix = Date.now();
let tenantAId: number;
let tenantBId: number;

/** Runs `fn` on a transaction that behaves exactly like a tenant-scoped request (see lib/tenantScope.ts's withTenantDb): SET LOCAL ROLE accuqual_app + the tenant id setting. Always rolled back. */
async function asTenant<T>(tenantId: number, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE accuqual_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("RLS coverage drift guard (live database)", () => {
  beforeAll(async () => {
    const [a] = await db.insert(tenants).values({ name: `RLS Live A ${suffix}`, code: `rls-live-a-${suffix}` }).returning();
    const [b] = await db.insert(tenants).values({ name: `RLS Live B ${suffix}`, code: `rls-live-b-${suffix}` }).returning();
    tenantAId = a!.id;
    tenantBId = b!.id;
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
    await pool.end();
  });

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

  it("no table has RLS switched on but ZERO policies (that hides every row from the app role)", async () => {
    const { rows } = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
      ORDER BY 1
    `);
    const policyless = rows.map((r) => r.table_name);
    expect(policyless, `RLS is on with no policy for: ${policyless.join(", ")} — add one to rls-policies.sql`).toEqual([]);
  });

  describe("tenants table, as a tenant-scoped session", () => {
    it("sees its own row and only its own row", async () => {
      const seen = await asTenant(tenantAId, async (q) => (await q("SELECT id FROM tenants")).rows.map((r) => r.id));
      expect(seen).toEqual([tenantAId]);
    });

    it("can update its own row but not another tenant's", async () => {
      const own = await asTenant(tenantAId, async (q) => (await q("UPDATE tenants SET name = name WHERE id = $1", [tenantAId])).rowCount);
      const other = await asTenant(tenantAId, async (q) => (await q("UPDATE tenants SET name = name WHERE id = $1", [tenantBId])).rowCount);
      expect(own).toBe(1);
      expect(other).toBe(0);
    });

    it("cannot create or delete tenants", async () => {
      await expect(asTenant(tenantAId, (q) => q("INSERT INTO tenants (name, code) VALUES ($1, $2)", ["Sneaky", `sneaky-${suffix}`]))).rejects.toThrow(/row-level security/i);
      const deleted = await asTenant(tenantAId, async (q) => (await q("DELETE FROM tenants WHERE id = $1", [tenantAId])).rowCount);
      expect(deleted).toBe(0);
    });

    it("fails closed without a tenant context — no rows (or an error), never every tenant", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE accuqual_app");
        // A reused connection has the setting left as an empty string, which the policy cannot cast to an int, so
        // Postgres raises instead of returning rows; a fresh one returns none. Either way nothing leaks.
        const outcome = await client.query("SELECT id FROM tenants").then((r) => r.rows, () => "error" as const);
        expect(outcome === "error" || (Array.isArray(outcome) && outcome.length === 0)).toBe(true);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  it("roles (the global system-role list) is readable but not writable by a tenant-scoped session", async () => {
    const count = await asTenant(tenantAId, async (q) => Number((await q("SELECT count(*)::int AS n FROM roles")).rows[0]!.n));
    expect(count).toBeGreaterThan(0);
    await expect(asTenant(tenantAId, (q) => q("INSERT INTO roles (name) VALUES ($1)", [`sneaky-${suffix}`]))).rejects.toThrow(/row-level security/i);
  });

  it("auth token tables are invisible to a tenant-scoped session (login/refresh/reset use the owner connection)", async () => {
    for (const table of ["refresh_tokens", "password_reset_tokens", "mfa_recovery_codes"]) {
      const count = await asTenant(tenantAId, async (q) => Number((await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n));
      expect(count, table).toBe(0);
    }
  });
});
