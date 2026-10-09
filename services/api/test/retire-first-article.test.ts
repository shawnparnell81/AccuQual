import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retire first article migration", () => {
  const sql = readFileSync(new URL("../src/drizzle/migrations/0114_retire_first_article.sql", import.meta.url), "utf8");
  const journal = JSON.parse(readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };

  it("is the next migration and deletes First Article rows without dropping the tables", () => {
    const entry = journal.entries.find((row) => row.tag === "0114_retire_first_article");
    expect(entry).toMatchObject({ idx: 114, tag: "0114_retire_first_article" });
    expect(journal.entries.find((row) => row.tag === "0113_user_record_numbers")?.idx).toBe(113);
    expect(sql).toContain("DELETE FROM fai_records");
    expect(sql).toContain("DELETE FROM csa_fai_records");
    expect(sql).toContain("DELETE FROM fuel_pump_fai_records");
    expect(sql).toContain("DELETE FROM qms_forms WHERE form_type = 'first_article_inspection'");
    expect(sql).toContain("DELETE FROM iso_quality_forms WHERE form_type = 'first_article'");
    expect(sql).toContain("form_key IN ('frm-fai-001', 'first_article_inspection')");
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).toContain("is_active = 'false'");
    expect(sql).toContain("First Article was removed");
    expect(sql).toContain("/blank-forms/start/");
  });
});
