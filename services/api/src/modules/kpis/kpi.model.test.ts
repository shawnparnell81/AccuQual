import { describe, expect, it } from "vitest";
import {
  ageDays,
  amberIsValid,
  calibrationOnTimePercent,
  DEFAULT_EXECUTIVE_CHARTS,
  defaultOwnerId,
  easternStart,
  isAuditFinding,
  monthWindow,
  objectiveStatus,
  percentOfTarget,
  recentMonthWindows,
  resolveChartLayout,
  seedObjectives,
} from "./kpi.model.js";

describe("kpi months", () => {
  it("starts Eastern months at the right UTC instant", () => {
    expect(easternStart(2026, 10, 1).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(easternStart(2026, 1, 1).toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("builds twelve month windows ending at the current Eastern month", () => {
    const now = new Date("2026-10-10T16:00:00.000Z");
    const windows = recentMonthWindows(now);
    expect(windows).toHaveLength(12);
    expect(windows[0]?.key).toBe("2025-11");
    expect(windows[11]?.key).toBe("2026-10");
    expect(windows[11]?.live).toBe(true);
    expect(windows[10]?.live).toBe(false);
    expect(monthWindow(2026, 10, now).snapshot.toISOString()).toBe(now.toISOString());
  });
});

describe("kpi status", () => {
  it("colors higher and lower targets, and leaves a blank actual alone", () => {
    expect(objectiveStatus(90, 90, "higher", 80)).toBe("green");
    expect(objectiveStatus(80, 90, "higher", 80)).toBe("amber");
    expect(objectiveStatus(70, 90, "higher", 80)).toBe("red");
    expect(objectiveStatus(30, 30, "lower", 45)).toBe("green");
    expect(objectiveStatus(45, 30, "lower", 45)).toBe("amber");
    expect(objectiveStatus(46, 30, "lower", 45)).toBe("red");
    expect(objectiveStatus(null, 90, "higher", 80)).toBe("none");
  });

  it("measures percent of target, including a zero actual when lower is better", () => {
    expect(percentOfTarget(45, 90, "higher")).toBe(50);
    expect(percentOfTarget(0, 2, "lower")).toBe(100);
    expect(percentOfTarget(4, 2, "lower")).toBe(50);
    expect(percentOfTarget(null, 2, "lower")).toBeNull();
  });

  it("requires the amber line on the worse side of the target", () => {
    expect(amberIsValid("higher", 90, 80)).toBe(true);
    expect(amberIsValid("higher", 90, 95)).toBe(false);
    expect(amberIsValid("lower", 5, 8)).toBe(true);
    expect(amberIsValid("lower", 5, 2)).toBe(false);
  });

  it("counts age in whole days", () => {
    const created = new Date("2026-09-01T04:00:00.000Z");
    expect(ageDays(created, new Date("2026-10-02T04:00:00.000Z"))).toBe(31);
  });
});

describe("kpi seeds and layout", () => {
  it("seeds the eight default objectives for Shawn Parnell's admin account", () => {
    const owner = defaultOwnerId([
      { id: 4, name: "Shawn Parnell", roleName: "operator" },
      { id: 9, name: " Shawn Parnell ", roleName: "admin" },
    ]);
    expect(owner).toBe(9);
    const rows = seedObjectives(owner, new Date("2026-10-10T16:00:00.000Z"));
    expect(rows.map((row) => row.id)).toEqual([
      "obj-capa-ontime",
      "obj-ncr-closure",
      "obj-ncr-within-30",
      "obj-ncr-aged",
      "obj-fai-pass",
      "obj-training",
      "obj-calibration",
      "obj-complaints",
    ]);
    expect(rows.every((row) => row.plantScope === "all" && row.reviewFrequency === "monthly" && row.ownerId === 9 && row.active)).toBe(true);
    expect(rows.find((row) => row.id === "obj-capa-ontime")).toMatchObject({ target: 90, amberThreshold: 80, direction: "higher" });
    expect(rows.find((row) => row.id === "obj-complaints")).toMatchObject({ target: 2, amberThreshold: 4, direction: "lower" });
  });

  it("uses the executive defaults until that person saves a layout, including an empty one", () => {
    expect(resolveChartLayout(undefined).executive).toEqual(DEFAULT_EXECUTIVE_CHARTS);
    expect(resolveChartLayout(undefined).home).toEqual([]);
    expect(resolveChartLayout(undefined).executiveIsDefault).toBe(true);
    const cleared = resolveChartLayout({ executive: [] });
    expect(cleared.executive).toEqual([]);
    expect(cleared.executiveIsDefault).toBe(false);
    expect(resolveChartLayout({ home: ["capa_on_time", "not-a-chart", "capa_on_time"] }).home).toEqual(["capa_on_time"]);
  });
});

describe("kpi source rules", () => {
  it("does not count an observation as a finding", () => {
    expect(isAuditFinding("observation", "looks fine")).toBe(false);
    expect(isAuditFinding("minor", "")).toBe(true);
    expect(isAuditFinding("", "")).toBe(false);
    expect(isAuditFinding("", "Missing record")).toBe(true);
  });

  it("counts current, upcoming, and due-soon gages as on time", () => {
    expect(calibrationOnTimePercent([])).toBeNull();
    expect(calibrationOnTimePercent(["current", "upcoming", "due_soon", "overdue"])).toBe(75);
  });
});
