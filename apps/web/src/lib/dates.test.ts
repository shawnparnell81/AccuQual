import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDate, dateInputValue, formatDate } from "./dates.ts";

describe("date-only values", () => {
  it("keeps a plain calendar day instead of the previous local day", () => {
    const october8 = new Date(Date.UTC(2026, 9, 8)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const september28 = new Date(Date.UTC(2026, 8, 28)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    assert.equal(calendarDate("2026-10-08"), "2026-10-08");
    assert.equal(dateInputValue("2026-10-08T00:00:00.000Z"), "2026-10-08");
    assert.equal(dateInputValue("2026-09-28"), "2026-09-28");
    assert.equal(formatDate("2026-10-08"), october8);
    assert.equal(formatDate("2026-10-08T00:00:00.000Z"), october8);
    assert.equal(formatDate("2026-09-28"), september28);
    assert.equal(formatDate("2026-09-28T00:00:00.000Z"), september28);
    assert.equal(formatDate("2026-09-28T12:00:00.000Z"), september28);
  });
});
