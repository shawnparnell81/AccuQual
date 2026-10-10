import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";

describe("merge Main plant into Greer", () => {
  beforeAll(async () => {
    await ensureTestCompany();
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("moves rows to Greer, deactivates Main plant, and leaves a null site unassigned", async () => {
    const before = await db.execute(sql`
      SELECT id, status, is_default, deleted_at
      FROM sites
      WHERE deleted_at IS NULL AND lower(btrim(name)) = 'main plant'
      ORDER BY id
      LIMIT 1
    `);
    const main = before.rows[0] as { id: number; status: string; is_default: boolean; deleted_at: Date | null };
    expect(main).toBeTruthy();
    expect(main.status).toBe("active");

    await db.execute(sql`SELECT accuqual_merge_main_plant_into_greer()`);
    const stillMain = await db.execute(sql`SELECT status, is_default, deleted_at FROM sites WHERE id = ${main.id}`);
    const untouched = stillMain.rows[0] as { status: string; is_default: boolean; deleted_at: Date | null };
    expect(untouched.status).toBe("active");
    expect(untouched.is_default).toBe(true);
    expect(untouched.deleted_at).toBeNull();

    const greerInsert = await db.execute(sql`
      INSERT INTO sites (name, code, status, is_default)
      VALUES ('Greer', 'greer-merge', 'active', false)
      RETURNING id
    `);
    const greerId = Number((greerInsert.rows[0] as { id: number }).id);

    const [person] = await db.insert(users).values({ email: `merge-${Date.now()}@test.local`, passwordHash: "unused", name: "Plant Merge" }).returning();
    await db.execute(sql`UPDATE users SET current_site_id = ${main.id} WHERE id = ${person!.id}`);
    await db.execute(sql`
      INSERT INTO user_sites (user_id, site_id) VALUES (${person!.id}, ${greerId})
      ON CONFLICT (user_id, site_id) DO NOTHING
    `);
    await db.execute(sql`INSERT INTO ncr (title, status, site_id) VALUES ('On main', 'ncr_created', ${main.id})`);
    await db.execute(sql`INSERT INTO complaints (description, status, record_number, customer_name) VALUES ('No site', 'open', 'CMP-MERGE-NONE', 'Acme')`);

    const auditsBefore = await db.execute(sql`SELECT count(*)::int AS n FROM audit_trail WHERE (changes->>'system') = 'true'`);
    const beforeCount = Number((auditsBefore.rows[0] as { n: number }).n);

    await db.execute(sql`SELECT accuqual_merge_main_plant_into_greer()`);

    const mainAfter = await db.execute(sql`SELECT name, status, is_default, deleted_at FROM sites WHERE id = ${main.id}`);
    const retired = mainAfter.rows[0] as { name: string; status: string; is_default: boolean; deleted_at: Date | null };
    expect(retired.name).toBe("Main plant");
    expect(retired.status).toBe("inactive");
    expect(retired.is_default).toBe(false);
    expect(retired.deleted_at).toBeNull();

    const greerAfter = await db.execute(sql`SELECT status, is_default, deleted_at FROM sites WHERE id = ${greerId}`);
    const primary = greerAfter.rows[0] as { status: string; is_default: boolean; deleted_at: Date | null };
    expect(primary.status).toBe("active");
    expect(primary.is_default).toBe(true);
    expect(primary.deleted_at).toBeNull();

    const ncr = await db.execute(sql`SELECT site_id FROM ncr WHERE title = 'On main'`);
    expect(Number((ncr.rows[0] as { site_id: number }).site_id)).toBe(greerId);

    const complaint = await db.execute(sql`SELECT site_id FROM complaints WHERE record_number = 'CMP-MERGE-NONE'`);
    expect((complaint.rows[0] as { site_id: number | null }).site_id).toBeNull();

    const current = await db.execute(sql`SELECT current_site_id FROM users WHERE id = ${person!.id}`);
    expect(Number((current.rows[0] as { current_site_id: number }).current_site_id)).toBe(greerId);

    const membership = await db.execute(sql`SELECT site_id FROM user_sites WHERE user_id = ${person!.id}`);
    expect(membership.rows.map((row) => Number((row as { site_id: number }).site_id))).toEqual([greerId]);

    const pointing = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM ncr WHERE site_id = ${main.id})
        + (SELECT count(*) FROM users WHERE current_site_id = ${main.id})
        + (SELECT count(*) FROM user_sites WHERE site_id = ${main.id}) AS n
    `);
    expect(Number((pointing.rows[0] as { n: number }).n)).toBe(0);

    const trail = await db.execute(sql`
      SELECT performed_by, changes
      FROM audit_trail
      WHERE entity_type = 'Site' AND entity_id = ${greerId} AND (changes->>'system') = 'true'
      ORDER BY id DESC
      LIMIT 1
    `);
    const entry = trail.rows[0] as { performed_by: number | null; changes: { summary?: string; duplicateAssignmentsRemoved?: number } };
    expect(entry.performed_by).toBeNull();
    expect(entry.changes.summary).toContain("Main plant was deactivated and was not deleted");
    expect(entry.changes.summary).toContain("Unassigned");
    expect(Number(entry.changes.duplicateAssignmentsRemoved)).toBeGreaterThanOrEqual(1);

    const auditsAfter = await db.execute(sql`SELECT count(*)::int AS n FROM audit_trail WHERE (changes->>'system') = 'true'`);
    expect(Number((auditsAfter.rows[0] as { n: number }).n)).toBe(beforeCount + 1);

    await db.execute(sql`SELECT accuqual_merge_main_plant_into_greer()`);
    const auditsAgain = await db.execute(sql`SELECT count(*)::int AS n FROM audit_trail WHERE (changes->>'system') = 'true'`);
    expect(Number((auditsAgain.rows[0] as { n: number }).n)).toBe(beforeCount + 1);
    const stillThere = await db.execute(sql`SELECT id, status, deleted_at FROM sites WHERE id = ${main.id}`);
    const row = stillThere.rows[0] as { status: string; deleted_at: Date | null };
    expect(row.status).toBe("inactive");
    expect(row.deleted_at).toBeNull();
  });
});
