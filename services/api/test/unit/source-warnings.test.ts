import { describe, expect, it } from "vitest";
import { sourceWarnings } from "../../src/modules/quality-engineering-report/sourceStore.js";

const row = (rowKey: string, date: string) => ({ source: "ncr" as const, rowKey, month: date.slice(0, 7), data: { __date: date } });

describe("monthly source import warnings", () => {
  it("flags future dates, rows dated today and repeated numbers", () => {
    const warnings = sourceWarnings([row("a", "2029-03-01"), row("b", "2026-10-15"), row("c", "2026-10-01"), row("c#2", "2026-10-01")], "2026-10-15");
    expect(warnings).toEqual([
      "1 row is dated in the future. Check the dates before importing.",
      "1 row is dated today. A date the file filled in automatically can look like this.",
      "1 row repeats a number already in the file. Each one is kept as its own row.",
    ]);
  });

  it("says nothing for a clean file", () => {
    expect(sourceWarnings([row("a", "2026-09-01")], "2026-10-15")).toEqual([]);
  });
});
