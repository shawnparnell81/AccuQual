import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("clear auto record numbers migration", () => {
  const sql = readFileSync(new URL("../src/drizzle/migrations/0116_clear_auto_record_numbers.sql", import.meta.url), "utf8");
  const journal = JSON.parse(readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };

  it("clears id-shaped numbers and id-embedded file names without dropping saved rows", () => {
    const entry = journal.entries.find((row) => row.tag === "0116_clear_auto_record_numbers");
    expect(entry).toMatchObject({ idx: 116, tag: "0116_clear_auto_record_numbers" });
    expect(journal.entries.find((row) => row.tag === "0115_pin_saved_form_folders")?.idx).toBe(115);
    expect(entry?.when).toBeGreaterThan(journal.entries.find((row) => row.idx === 115)?.when ?? 0);
    expect(sql).toContain("'NCR-' || id::text");
    expect(sql).toContain("'VAL-' || id::text");
    expect(sql).toContain("'SCAR-' || id::text");
    expect(sql).toContain("FAI-");
    expect(sql).toContain("regexp_replace");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "updated_at"');
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
