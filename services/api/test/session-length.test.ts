import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_LENGTH_HOURS, sessionLengthHoursFromProfile, sessionLengthMs } from "../src/modules/auth/sessionLength.js";

describe("company session length", () => {
  it("defaults to 12 hours when the company has not chosen one", () => {
    expect(DEFAULT_SESSION_LENGTH_HOURS).toBe(12);
    expect(sessionLengthHoursFromProfile(null)).toBe(12);
    expect(sessionLengthHoursFromProfile({})).toBe(12);
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 0 })).toBe(12);
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 12.5 })).toBe(12);
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 36 })).toBe(12);
    expect(sessionLengthMs(12)).toBe(12 * 60 * 60 * 1000);
  });

  it("keeps an in-range whole-hour choice", () => {
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 1 })).toBe(1);
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 8 })).toBe(8);
    expect(sessionLengthHoursFromProfile({ sessionLengthHours: 24 })).toBe(24);
  });
});
