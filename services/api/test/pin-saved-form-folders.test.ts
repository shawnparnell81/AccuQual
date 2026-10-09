import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pin saved form folders migration", () => {
  const sql = readFileSync(new URL("../src/drizzle/migrations/0115_pin_saved_form_folders.sql", import.meta.url), "utf8");
  const journal = JSON.parse(readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };

  it("pins existing title-matched records and does not delete filings", () => {
    const entry = journal.entries.find((row) => row.tag === "0115_pin_saved_form_folders");
    expect(entry).toMatchObject({ idx: 115, tag: "0115_pin_saved_form_folders" });
    expect(journal.entries.find((row) => row.tag === "0114_retire_first_article")?.idx).toBe(114);
    expect(entry?.when).toBeGreaterThan(journal.entries.find((row) => row.idx === 114)?.when ?? 0);
    expect(sql).toContain("INSERT INTO form_filings");
    expect(sql).toContain("ON CONFLICT (form_key, record_id) DO NOTHING");
    expect(sql).toContain("'supplier-ncr'");
    expect(sql).toContain("'Customer Complaint Record'");
    expect(sql).toContain("'training-record'");
    expect(sql).not.toMatch(/DELETE FROM form_filings/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
