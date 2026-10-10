import { describe, expect, it } from "vitest";
import { LOGIN_HISTORY_START_ISO, loginHistoryStartsAt, parseRecordingStart, recordingOpen, recordingStartNotice, utcToEasternWall } from "../../src/modules/auth/loginHistoryStart.js";

const START = new Date(LOGIN_HISTORY_START_ISO);

describe("login history recording start", () => {
  it("defaults to Oct 12, 2026 12:00 AM Eastern when the company has not set one", () => {
    expect(loginHistoryStartsAt(null).toISOString()).toBe(LOGIN_HISTORY_START_ISO);
    expect(loginHistoryStartsAt({}).toISOString()).toBe(LOGIN_HISTORY_START_ISO);
    expect(loginHistoryStartsAt({ loginHistoryStartsAt: "not-a-date" }).toISOString()).toBe(LOGIN_HISTORY_START_ISO);
    expect(recordingStartNotice(START)).toBe("Recording starts Oct 12, 2026 12:00 AM ET");
    expect(utcToEasternWall(START)).toBe("2026-10-12T00:00");
  });

  it("stays closed until the start instant and opens on that instant", () => {
    expect(recordingOpen(START, new Date("2026-10-12T03:59:59.999Z"))).toBe(false);
    expect(recordingOpen(START, new Date("2026-10-12T04:00:00.000Z"))).toBe(true);
    expect(recordingOpen(START, new Date("2026-10-12T04:00:00.001Z"))).toBe(true);
  });

  it("reads an Eastern wall clock and a UTC instant", () => {
    expect(parseRecordingStart("2026-10-12T00:00")?.toISOString()).toBe(LOGIN_HISTORY_START_ISO);
    expect(parseRecordingStart("2026-01-15T00:00")?.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(parseRecordingStart("2026-10-12T04:00:00.000Z")?.toISOString()).toBe(LOGIN_HISTORY_START_ISO);
    expect(parseRecordingStart("nope")).toBeNull();
    const custom = loginHistoryStartsAt({ loginHistoryStartsAt: "2026-11-01T05:00:00.000Z" });
    expect(recordingOpen(custom, new Date("2026-11-01T04:59:00.000Z"))).toBe(false);
    expect(recordingOpen(custom, new Date("2026-11-01T05:00:00.000Z"))).toBe(true);
  });
});
