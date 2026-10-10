import { describe, expect, it } from "vitest";
import { reasonableDate } from "../../src/utils/validation.js";
import { ncrIsoDate } from "../../src/modules/ncr/ncr.formSync.js";

describe("calendar dates", () => {
  it("stores a date-only value at UTC noon so western timezones keep the day", () => {
    const parsed = reasonableDate.parse("2026-10-08");
    expect(parsed.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(ncrIsoDate("2026-09-28")).toBe("2026-09-28");
    expect(ncrIsoDate("2026-10-08T00:00:00.000Z")).toBe("2026-10-08");
  });
});
