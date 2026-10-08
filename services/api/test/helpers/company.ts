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
    await client.query("DELETE FROM roles WHERE name NOT IN ('owner', 'admin', 'president', 'vice_president', 'director', 'quality_manager', 'lead', 'operator', 'staff', 'read_only', 'auditor', 'supplier', 'customer')");
    await client.query(`
      INSERT INTO roles (name, description, hierarchy_level, is_protected, permissions) VALUES
        ('owner', 'Owner — full access to everything', 10, true, '["import_data", "restore_archived_documents", "plants.delete"]'::jsonb),
        ('admin', 'Administrator — full access', 15, true, '["import_data", "restore_archived_documents", "plants.delete"]'::jsonb),
        ('president', 'President — can view the quality system and approve work', 20, true, '[]'::jsonb),
        ('vice_president', 'Vice President — can view the quality system and approve work', 30, true, '[]'::jsonb),
        ('director', 'Director — can view the quality system and approve work', 40, true, '[]'::jsonb),
        ('quality_manager', 'Manages NCR/CAPA/Audits/Suppliers', 50, true, '[]'::jsonb),
        ('lead', 'Lead — supervises day-to-day work', 60, true, '[]'::jsonb),
        ('operator', 'Shop-floor / production user', 80, true, '["folders.delete", "folders.rename"]'::jsonb),
        ('staff', 'Staff — day-to-day work', 80, true, '[]'::jsonb),
        ('read_only', 'Read-only — can view records but not change them', 90, true, '[]'::jsonb),
        ('auditor', 'Conducts audits and reviews findings', 92, true, '[]'::jsonb),
        ('supplier', 'External supplier portal access', 95, true, '[]'::jsonb),
        ('customer', 'External customer portal access', 100, true, '[]'::jsonb)
      ON CONFLICT (name) DO UPDATE SET
        hierarchy_level = EXCLUDED.hierarchy_level,
        is_protected = EXCLUDED.is_protected,
        description = EXCLUDED.description,
        permissions = EXCLUDED.permissions
    `);
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
