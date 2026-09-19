// Pure-logic unit test — no DB (see tenant-isolation.test.ts's header
// comment on the distinction; this only reads schema objects and a SQL
// file's text, never connects to Postgres). Full-System Audit finding M4:
// rls-policies.sql's `tenant_tables` array is a hand-maintained list with no
// automated check that it actually matches every real tenant-scoped table —
// a new module's table could ship with a real `tenantId` column and simply
// never get RLS enabled, silently, the same class of drift H5 already found
// in indexes.sql's own tenant_tables array.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/drizzle/schema/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rlsPoliciesPath = path.join(__dirname, "../src/drizzle/post-migrate/rls-policies.sql");

/** Every real Drizzle table object exported from the schema barrel, deduped (some tables are re-exported under more than one name). */
function allSchemaTables(): PgTable[] {
  const seen = new Set<PgTable>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable) && !seen.has(value)) seen.add(value);
  }
  return [...seen];
}

/** Real Postgres table name + whether it has a tenant_id column, from the actual Drizzle table definition — not a text heuristic. */
function describeTable(table: PgTable) {
  const config = getTableConfig(table);
  return { name: config.name, hasTenantId: config.columns.some((c) => c.name === "tenant_id") };
}

/**
 * Tables that intentionally have no tenant_id column and are deliberately
 * excluded from RLS: `roles` (platform-wide constants, see README's own
 * documented exception), `tenants` itself (it IS the tenant, not owned by
 * one), `password_reset_tokens` (queried before a tenant is even known —
 * see that schema file's own comment), and `refresh_tokens` (same reasoning
 * — auth.service.ts's refresh() derives the user/tenant from the token
 * itself, before any req.tenantId exists). Nothing else is silently
 * exempted: a real future table with no tenant_id and not listed here fails
 * the third test below instead of passing unnoticed.
 */
const DELIBERATELY_GLOBAL_TABLES = new Set(["roles", "tenants", "password_reset_tokens", "refresh_tokens"]);

function tenantTablesArrayFromSql(): Set<string> {
  const sql = readFileSync(rlsPoliciesPath, "utf8");
  const match = /tenant_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(sql);
  if (!match) throw new Error("Could not find rls-policies.sql's tenant_tables ARRAY[...] literal — the file's shape changed.");
  const names = [...match[1]!.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!);
  return new Set(names);
}

describe("RLS coverage (rls-policies.sql vs. real schema)", () => {
  it("every real tenant-scoped table is listed in rls-policies.sql's tenant_tables array", () => {
    const listed = tenantTablesArrayFromSql();
    const missing = allSchemaTables()
      .map(describeTable)
      .filter((t) => t.hasTenantId && !DELIBERATELY_GLOBAL_TABLES.has(t.name) && !listed.has(t.name))
      .map((t) => t.name);

    expect(missing, `Tenant-scoped table(s) missing from rls-policies.sql's tenant_tables array — RLS is never enabled for: ${missing.join(", ")}`).toEqual([]);
  });

  it("rls-policies.sql doesn't list a table that no longer exists in the real schema", () => {
    const listed = tenantTablesArrayFromSql();
    const realNames = new Set(allSchemaTables().map((t) => describeTable(t).name));
    const stale = [...listed].filter((name) => !realNames.has(name));

    expect(stale, `rls-policies.sql lists table(s) that don't exist in the real schema — stale entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("every table WITHOUT a tenant_id column is one of the deliberately-global exceptions, not an accident", () => {
    const withoutTenantId = allSchemaTables()
      .map(describeTable)
      .filter((t) => !t.hasTenantId)
      .map((t) => t.name);

    expect(new Set(withoutTenantId)).toEqual(DELIBERATELY_GLOBAL_TABLES);
  });
});
