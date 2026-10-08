import { ensureTestCompany } from "../helpers/company.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { DUPLICATE_RECORD_NUMBER } from "../../src/modules/records/userRecordNumber.js";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `record-number-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
}

describe("user-entered record numbers", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser();
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("a new record has no auto number and a blank number never shows the internal id", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Unnumbered issue", severity: "low" });
    expect(created.status).toBe(201);
    expect(created.body.recordNumber).toBeNull();
    expect(JSON.stringify(created.body)).not.toContain(`NCR-${created.body.id}`);

    const loaded = await request(app).get(`/ncr/${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.recordNumber).toBeNull();
    expect(loaded.body.recordNumber).not.toBe(String(loaded.body.id));

    const [form] = await db.select().from(formData).where(and(eq(formData.formType, "ncr"), eq(formData.entityId, created.body.id)));
    const data = (form?.data ?? {}) as Record<string, unknown>;
    expect(data.ncrNumber ?? "").not.toBe(`NCR-${created.body.id}`);
    expect(String(data.ncrNumber ?? "")).not.toBe(String(created.body.id));
  });

  it("a typed number saves, edits are audited, and duplicates are rejected within a type but allowed across types", async () => {
    const number = `QA ${suffix}`;
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Numbered issue", severity: "medium", recordNumber: number });
    expect(created.status).toBe(201);
    expect(created.body.recordNumber).toBe(number);

    const duplicate = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Same number", severity: "low", recordNumber: `qa${suffix}` });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toBe(DUPLICATE_RECORD_NUMBER);

    const capaRes = await request(app).post("/capa").set("Authorization", `Bearer ${qualityToken}`).send({ recordNumber: number, rootCause: "Allowed on another type" });
    expect(capaRes.status).toBe(201);
    expect(capaRes.body.recordNumber).toBe(number);

    const next = `QA-${suffix}-B`;
    const edited = await request(app).patch(`/ncr/${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ recordNumber: next });
    expect(edited.status).toBe(200);
    expect(edited.body.recordNumber).toBe(next);

    const rows = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "NCR"), eq(auditTrail.entityId, created.body.id), eq(auditTrail.action, "update")))
      .orderBy(desc(auditTrail.createdAt));
    const audit = rows.find((row) => {
      const changes = row.changes as { numberEdit?: unknown } | null;
      return Boolean(changes?.numberEdit);
    });
    const changes = audit?.changes as { numberEdit?: { label?: string; from?: string; to?: string } } | null;
    expect(changes?.numberEdit).toMatchObject({ label: "NCR No.", from: number, to: next });
  });

  it("leaves an existing colliding number in place instead of failing the migration", async () => {
    const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/drizzle/migrations/0113_user_record_numbers.sql");
    const statements = readFileSync(migrationPath, "utf8").split("--> statement-breakpoint").map((part) => part.trim());
    expect(statements.some((part) => /^\s*CREATE UNIQUE INDEX/i.test(part))).toBe(false);
    expect(statements.some((part) => /^\s*ALTER TABLE[\s\S]*DROP CONSTRAINT/i.test(part))).toBe(false);
    const block = statements.find((part) => part.includes("DO $migrate$"));
    expect(block).toContain("Those rows were left unchanged");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DROP INDEX IF EXISTS "ncr_record_number_key"`);
      const inserted = await client.query<{ id: number; record_number: string }>(
        `INSERT INTO "ncr" ("title", "record_number") VALUES ('collision left', 'Dup 1'), ('collision right', 'dup1') RETURNING id, record_number`,
      );
      await client.query(block!);
      const after = await client.query<{ record_number: string }>(
        `SELECT record_number FROM "ncr" WHERE id = ANY($1::int[]) ORDER BY id`,
        [inserted.rows.map((row) => row.id)],
      );
      expect(after.rows.map((row) => row.record_number)).toEqual(["Dup 1", "dup1"]);
      const index = await client.query<{ name: string | null }>(`SELECT to_regclass('public.ncr_record_number_key') AS name`);
      expect(index.rows[0]?.name).toBeNull();
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const restored = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.ncr_record_number_key') AS name`);
    expect(restored.rows[0]?.name).toBe("ncr_record_number_key");
  });
});
