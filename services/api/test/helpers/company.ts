import pg from "pg";
import { db } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";

let wiped = false;

/**
 * Every test file starts from an empty database. The suite shares one database and one company, and a file's own
 * clean-up may be interrupted by a failing test, so the first call in each file wipes whatever the previous file left
 * behind: every table except the small list of built-in roles.
 */
async function wipeDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'roles'");
    if (rows.length > 0) await client.query(`TRUNCATE ${rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await client.query("DELETE FROM roles WHERE name NOT IN ('admin', 'quality_manager', 'auditor', 'operator', 'supplier', 'customer')");
    await client.query(
      "INSERT INTO roles (name, description) VALUES ('admin', 'Administrator'), ('quality_manager', 'Quality manager'), ('auditor', 'Auditor'), ('operator', 'Operator'), ('supplier', 'Supplier portal'), ('customer', 'Customer portal') ON CONFLICT (name) DO NOTHING",
    );
  } finally {
    await client.end();
  }
}

/** The one company row every test runs against: returns it, creating it the first time (after wiping the database once per file). */
export async function ensureTestCompany() {
  if (!wiped) {
    wiped = true;
    await wipeDatabase();
  }
  const [existing] = await db.select().from(company).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(company).values({ name: "Test Company" }).returning();
  return created!;
}
