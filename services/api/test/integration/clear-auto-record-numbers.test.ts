import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/index.js";

describe("clear auto record numbers", () => {
  it("nulls an id-shaped number, keeps a typed number, and drops the id from a saved-copy file name", async () => {
    const sql = readFileSync(new URL("../../src/drizzle/migrations/0116_clear_auto_record_numbers.sql", import.meta.url), "utf8");
    const clearValidation = sql.split("--> statement-breakpoint").map((part) => part.trim()).find((part) => part.includes('UPDATE "validation_reports"'));
    const clearNames = sql.split("--> statement-breakpoint").map((part) => part.trim()).find((part) => part.includes("regexp_replace"));
    expect(clearValidation).toBeTruthy();
    expect(clearNames).toBeTruthy();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auto = await client.query<{ id: number }>(
        `INSERT INTO validation_reports (data, record_number) VALUES ('{"formType":"csa"}'::jsonb, 'TEMP') RETURNING id`,
      );
      const id = auto.rows[0]!.id;
      await client.query(`UPDATE validation_reports SET record_number = 'VAL-' || id::text WHERE id = $1`, [id]);
      const typed = await client.query<{ id: number }>(
        `INSERT INTO validation_reports (data, record_number) VALUES ('{"formType":"csa"}'::jsonb, 'TEST-1008-03') RETURNING id`,
      );
      await client.query(clearValidation!);
      const numbers = await client.query<{ id: number; record_number: string | null }>(
        `SELECT id, record_number FROM validation_reports WHERE id = ANY($1::int[]) ORDER BY id`,
        [[id, typed.rows[0]!.id]],
      );
      expect(numbers.rows.find((row) => row.id === id)?.record_number).toBeNull();
      expect(numbers.rows.find((row) => row.id === typed.rows[0]!.id)?.record_number).toBe("TEST-1008-03");

      const embedded = await client.query<{ id: number }>(
        `INSERT INTO document_folders (name, linked_path, sort_order) VALUES ($1, $2, 0) RETURNING id`,
        [`FRM-VAL-001_${id}_2026-10-09`, `/validation-reports/${id}`],
      );
      const keptName = await client.query<{ id: number }>(
        `INSERT INTO document_folders (name, linked_path, sort_order) VALUES ($1, $2, 0) RETURNING id`,
        [`FRM-VAL-001_QA-14_2026-10-09`, `/validation-reports/${typed.rows[0]!.id}`],
      );
      await client.query(clearNames!);
      const names = await client.query<{ id: number; name: string }>(
        `SELECT id, name FROM document_folders WHERE id = ANY($1::int[])`,
        [[embedded.rows[0]!.id, keptName.rows[0]!.id]],
      );
      expect(names.rows.find((row) => row.id === embedded.rows[0]!.id)?.name).toBe("FRM-VAL-001_2026-10-09");
      expect(names.rows.find((row) => row.id === keptName.rows[0]!.id)?.name).toBe("FRM-VAL-001_QA-14_2026-10-09");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
