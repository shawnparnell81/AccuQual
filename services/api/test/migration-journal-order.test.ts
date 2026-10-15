// Migrations must be added with a journal time later than the one before them.
// 0074_single_company is the one known exception: it is already applied everywhere and is left as it is.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = JSON.parse(readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
const KNOWN_OUT_OF_ORDER = new Set(["0074_single_company"]);

describe("migration journal", () => {
  it("numbers the migrations in order with no gaps", () => {
    journal.entries.forEach((entry, i) => expect(entry.idx).toBe(i));
  });

  it("gives every new migration a later time than the one before it", () => {
    const outOfOrder = journal.entries.filter((entry, i) => i > 0 && entry.when <= journal.entries[i - 1]!.when).map((entry) => entry.tag);
    expect(outOfOrder.filter((tag) => !KNOWN_OUT_OF_ORDER.has(tag))).toEqual([]);
  });
});
